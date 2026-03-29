/**
 * 应用主入口 — 微信 ↔ Notion 双向桥接服务
 *
 * 初始化流程：
 * 1. 加载配置 → 创建 Store → 创建 NotionClient
 * 2. 收集所有工具 → 创建 Router
 * 3. 初始化 WxToNotion + NotionToWx 桥接器
 * 4. 如果配置了 notionDatabaseId，启动 Notion 变更轮询
 * 5. 启动 HTTP Server，注册 5 个路由
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
import { manifest } from "./hub/manifest.js";
import { HubClient } from "./hub/client.js";
import type { HubEvent } from "./hub/types.js";

// ─── 初始化 ────────────────────────────────────────────────

const config = loadConfig();
const store = new Store(config.dbPath);
const notionClient = new NotionClient(config.notionToken);

console.log(`[app] 启动 ${manifest.name} (${manifest.slug})`);
console.log(`[app] Hub: ${config.hubUrl}`);
console.log(`[app] 回调地址: ${config.baseUrl}`);

// 收集所有 AI Tools 并创建路由器
const { definitions, handlers } = collectAllTools(notionClient);
const router = new Router({ definitions, handlers, store });
console.log(`[app] 已注册 ${definitions.length} 个工具`);

// 桥接器
const wxToNotion = new WxToNotion(notionClient, store, config.notionDatabaseId || undefined);
const notionToWx = new NotionToWx(store);

// ─── Notion 变更轮询 ──────────────────────────────────────

let pollingHandle: { stop: () => void } | null = null;

if (config.notionDatabaseId) {
  pollingHandle = startNotionPolling(
    notionClient,
    config.notionDatabaseId,
    async (changeEvent) => {
      const installations = store.getAllInstallations();
      await notionToWx.handleNotionChange(changeEvent, installations);
    },
  );
  console.log(`[app] Notion 轮询已启动，数据库=${config.notionDatabaseId}`);
}

// ─── Hub 事件处理 ─────────────────────────────────────────

/**
 * 处理 Hub 推送的业务事件
 * - message → wxToNotion（微信消息写入 Notion）
 * - command → router（AI Tool 调用）
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

    case "command": {
      // AI Tool 命令 → 路由到对应处理函数
      await router.handleAndReply(event, hubClient);
      break;
    }

    default:
      console.log(`[event] 未处理的事件类型: ${subType}`);
  }
}

// ─── HTTP Server ──────────────────────────────────────────

const oauthOpts = { config, store };

async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    // POST /hub/webhook — 接收 Hub 推送事件
    if (pathname === "/hub/webhook" && req.method === "POST") {
      await handleWebhook(req, res, { store, onEvent });
      return;
    }

    // GET /oauth/setup — 启动 OAuth 安装流程
    if (pathname === "/oauth/setup" && req.method === "GET") {
      handleOAuthStart(req, res, oauthOpts);
      return;
    }

    // GET /oauth/redirect — OAuth 回调
    if (pathname === "/oauth/redirect" && req.method === "GET") {
      await handleOAuthCallback(req, res, oauthOpts);
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
  console.log(`[app] 路由: POST /hub/webhook | GET /oauth/setup | GET /oauth/redirect | GET /manifest.json | GET /health`);
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
