/**
 * 应用主入口 — 微信 ↔ Notion 双向桥接服务
 *
 * 初始化流程：
 * 1. 加载配置 → 创建 Store → 创建 NotionClient（如果有凭证）
 * 2. 收集所有工具 → 创建 Router
 * 3. 初始化 WxToNotion + NotionToWx 桥接器（如果有凭证）
 * 4. 如果配置了 notionDatabaseId，启动 Notion 变更轮询
 * 5. 启动 HTTP Server，注册路由
 * 6. 监听 SIGINT/SIGTERM 优雅关闭
 */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { NotionClient } from "./notion/client.js";
import { collectAllTools } from "./tools/index.js";
import { Router } from "./router.js";
import { WxToNotion } from "./bridge/wx-to-notion.js";
import { NotionToWx } from "./bridge/notion-to-wx.js";
import { startNotionPolling } from "./notion/event.js";
import { handleWebhook } from "./hub/webhook.js";
import { handleOAuthStart, handleOAuthCallback } from "./hub/oauth.js";
import { handleSettingsPage, handleSettingsVerify, handleSettingsSave } from "./hub/settings.js";
import { manifest } from "./hub/manifest.js";
import { HubClient } from "./hub/client.js";
import type { HubEvent, Installation } from "./hub/types.js";

// ─── 初始化 ────────────────────────────────────────────────

const config = loadConfig();
const store = new Store(config.dbPath);

// 初始化 Notion 客户端（如果环境变量中配置了 Notion Token）
const hasNotionCredentials = !!config.notionToken;
const notionClient = hasNotionCredentials
  ? new NotionClient(config.notionToken)
  : null;

if (notionClient) {
  console.log("[app] Notion 客户端初始化完成");
} else {
  console.log("[app] 未配置 Notion Token，跳过默认客户端初始化（云端托管模式，用户安装时填写）");
}

console.log(`[app] 启动 ${manifest.name} (${manifest.slug})`);
console.log(`[app] Hub: ${config.hubUrl}`);
console.log(`[app] 回调地址: ${config.baseUrl}`);

// 收集所有 AI Tools 并创建路由器（如果没有默认客户端则用空 token 客户端仅收集定义）
const toolsSdkClient = notionClient ?? new NotionClient("");
const { definitions, handlers } = collectAllTools(toolsSdkClient);
const router = new Router({ definitions, handlers, store });
console.log(`[app] 已注册 ${definitions.length} 个工具`);

// 设置 manifest 的 URL 字段
manifest.oauth_setup_url = `${config.baseUrl}/oauth/setup`;
manifest.oauth_redirect_url = `${config.baseUrl}/oauth/redirect`;
manifest.webhook_url = `${config.baseUrl}/hub/webhook`;

// 桥接器（仅在配置了 Notion 凭证时启用）
const wxToNotion = notionClient ? new WxToNotion(notionClient, store, config.notionDatabaseId || undefined) : null;
const notionToWx = notionClient ? new NotionToWx(store) : null;

// ─── Notion 变更轮询 ──────────────────────────────────────

let pollingHandle: { stop: () => void } | null = null;

if (notionClient && config.notionDatabaseId) {
  pollingHandle = startNotionPolling(
    notionClient,
    config.notionDatabaseId,
    async (changeEvent) => {
      const installations = store.getAllInstallations();
      if (notionToWx) {
        await notionToWx.handleNotionChange(changeEvent, installations);
      }
    },
  );
  console.log(`[app] Notion 轮询已启动，数据库=${config.notionDatabaseId}`);
} else if (!notionClient) {
  console.log("[app] 未配置 Notion 凭证，跳过 Notion 变更轮询");
}

// ─── Hub 事件处理 ─────────────────────────────────────────

/** 获取 HubClient 实例（用于异步回复等场景） */
function getHubClient(installation: Installation): HubClient {
  return new HubClient(installation.hubUrl, installation.appToken);
}

/**
 * 处理 Hub 推送的普通事件（非 command）
 * - message → wxToNotion（微信消息写入 Notion）
 */
async function onEvent(event: HubEvent): Promise<void> {
  const subType = event.event?.type;
  const eventData = event.event?.data;

  console.log(`[event] 收到事件: type=${subType}, id=${event.event?.id}, trace=${event.trace_id}`);

  if (!subType || !eventData) return;

  const installation = store.getInstallation(event.installation_id);
  if (!installation) {
    console.warn("[event] 安装实例不存在:", event.installation_id);
    return;
  }

  const hubClient = new HubClient(installation.hubUrl, installation.appToken);

  switch (subType) {
    case "message": {
      // 微信消息 → 转发到 Notion
      if (!wxToNotion) {
        console.warn("[event] Notion 客户端未初始化，无法转发消息");
        return;
      }
      const wxEvent = {
        type: "message" as const,
        fromId: (eventData.from_id as string) || "",
        fromName: (eventData.from_name as string) || "",
        content: (eventData.content as string) || "",
        timestamp: Date.parse(event.event!.timestamp) || Date.now(),
      };
      try {
        await wxToNotion.handleWxEvent(wxEvent, installation);
      } catch (err) {
        console.error("[event] 消息转发到 Notion 失败:", err);
        await hubClient.sendMessage({
          userId: wxEvent.fromId,
          text: "[Notion Bridge] 消息记录失败，请稍后重试",
          traceId: event.trace_id,
        });
      }
      break;
    }

    default:
      console.log(`[event] 未处理的事件类型: ${subType}`);
  }
}

/**
 * 处理 command 事件（同步/异步超时由 webhook 层控制）
 * 返回工具执行结果文本，null 表示无需回复
 * 优先从本地加密配置中读取凭证
 */
async function onCommand(event: HubEvent, _installation: Installation): Promise<string | null> {
  console.log(`[event] 收到 command 事件: id=${event.event?.id}, trace=${event.trace_id}`);

  /** 尝试读取本地加密配置 */
  const localCfg = store.getConfig(event.installation_id, _installation.appToken);
  if (localCfg) {
    console.log(`[app] 使用安装 ${event.installation_id} 的本地加密配置`);
  }

  const result = await router.handleCommand(event);
  return result ?? null;
}

// ─── HTTP Server ──────────────────────────────────────────

const oauthOpts = { config, store, tools: definitions };

async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    // POST /hub/webhook — 接收 Hub 推送事件
    if (pathname === "/hub/webhook" && req.method === "POST") {
      await handleWebhook(req, res, { store, onEvent, onCommand, getHubClient });
      return;
    }

    // GET/POST /oauth/setup — 启动 OAuth 安装流程（GET 显示配置表单，POST 提交后跳转授权）
    if (pathname === "/oauth/setup" && (req.method === "GET" || req.method === "POST")) {
      await handleOAuthStart(req, res, oauthOpts);
      return;
    }

    // GET /oauth/redirect — OAuth 回调
    if (pathname === "/oauth/redirect" && req.method === "GET") {
      await handleOAuthCallback(req, res, oauthOpts);
      return;
    }

    // POST /oauth/redirect — 模式 2: Hub 直接安装通知
    if (pathname === "/oauth/redirect" && req.method === "POST") {
      const body = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
      });
      const data = JSON.parse(body.toString());
      store.saveInstallation({
        id: data.installation_id,
        hubUrl: data.hub_url || config.hubUrl,
        appId: "",
        botId: data.bot_id || "",
        appToken: data.app_token,
        webhookSecret: data.webhook_secret,
        createdAt: new Date().toISOString(),
      });
      console.log("[oauth] 模式2安装成功, installation_id:", data.installation_id);
      // 安装后拉取配置并加密存储
      const mode2Hub = new HubClient(data.hub_url || config.hubUrl, data.app_token);
      mode2Hub.fetchConfig()
        .then((remoteCfg) => {
          if (Object.keys(remoteCfg).length > 0) {
            store.saveConfig(data.installation_id, remoteCfg, data.app_token);
            console.log("[oauth] 模式2: 已拉取并加密保存配置:", data.installation_id);
          }
        })
        .catch((err) => console.error("[oauth] 模式2: 拉取配置失败:", err));
      // 异步同步工具定义到 Hub
      mode2Hub.syncTools(definitions)
        .catch((err) => console.error("[oauth] 模式2同步工具失败:", err));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ webhook_url: `${config.baseUrl}/hub/webhook` }));
      return;
    }

    // GET /settings — 设置页面（输入 token 验证身份）
    if (req.method === "GET" && pathname === "/settings") {
      handleSettingsPage(req, res);
      return;
    }

    // POST /settings/verify — 验证 token 后显示配置表单
    if (req.method === "POST" && pathname === "/settings/verify") {
      await handleSettingsVerify(req, res, config, store);
      return;
    }

    // POST /settings/save — 保存修改后的配置
    if (req.method === "POST" && pathname === "/settings/save") {
      await handleSettingsSave(req, res, config, store);
      return;
    }

    // GET /manifest.json — 返回应用清单（含工具定义）
    if (pathname === "/manifest.json" && req.method === "GET") {
      const body = {
        ...manifest,
        tools: definitions,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body, null, 2));
      return;
    }

    // GET /health — 健康检查
    if (pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", tools: definitions.length }));
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  } catch (err) {
    console.error("[http] 请求处理异常:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  }
}

const server = createServer((req, res) => {
  requestHandler(req, res).catch((err) => {
    console.error("[http] 未捕获异常:", err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end();
    }
  });
});

server.listen(Number(config.port), () => {
  console.log(`[app] 服务已启动，监听端口 ${config.port}`);
  console.log(`[app] 路由: POST /hub/webhook | GET/POST /oauth/setup | GET /oauth/redirect | GET /settings | GET /manifest.json | GET /health`);

  // 启动时同步工具定义到所有已安装的 Hub 实例
  const installations = store.getAllInstallations();
  for (const inst of installations) {
    const hubClient = new HubClient(inst.hubUrl, inst.appToken);
    hubClient.syncTools(definitions).catch((err) => {
      console.error(`[app] 启动同步工具失败 (installation=${inst.id}):`, err);
    });
  }
  if (installations.length > 0) {
    console.log(`[app] 正在向 ${installations.length} 个安装实例同步工具定义`);
  }
});

// ─── 优雅关闭 ─────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`\n[app] 收到 ${signal}，正在关闭服务...`);

  // 停止 Notion 轮询
  if (pollingHandle) {
    pollingHandle.stop();
    pollingHandle = null;
  }

  // 关闭数据库
  store.close();

  // 关闭 HTTP Server
  server.close(() => {
    console.log("[app] 服务已关闭");
    process.exit(0);
  });

  // 超时强制退出
  setTimeout(() => {
    console.error("[app] 关闭超时，强制退出");
    process.exit(1);
  }, 10_000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
