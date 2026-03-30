/**
 * OAuth PKCE 授权流程处理（含 setup 配置页）
 *
 * 流程：
 * 1. 用户访问 GET /oauth/setup → 显示 Notion 配置表单
 * 2. 用户填写后 POST /oauth/setup → 生成 PKCE 码对，重定向到 Hub 授权页
 * 3. Hub 回调 GET /oauth/redirect?code=xxx&state=xxx
 *    → 用 code + code_verifier 换取 token
 * 4. 将安装信息持久化到 Store
 * 5. 安装成功后同步工具定义到 Hub
 */

import { generatePKCE } from "../utils/crypto.js";
import type { Store } from "../store.js";
import type { Config } from "../config.js";
import type { Installation, ToolDefinition } from "./types.js";
import { HubClient } from "./client.js";
import type { IncomingMessage, ServerResponse } from "node:http";

/** PKCE 缓存条目（含用户填写的 Notion Key 配置） */
interface PKCEEntry {
  verifier: string;
  /** Hub 服务地址（从查询参数传入） */
  hubUrl: string;
  /** 应用 ID */
  appId: string;
  /** 安装完成后的重定向地址 */
  returnUrl: string;
  /** 用户在 setup 页面填写的 Notion 凭证 */
  userConfig?: Record<string, string>;
  expiresAt: number;
}

/** PKCE 缓存，key 为 state，10 分钟过期 */
const pkceCache = new Map<string, PKCEEntry>();

/** 缓存过期时间：10 分钟 */
const PKCE_TTL_MS = 10 * 60 * 1000;

/** 清理过期的 PKCE 条目 */
function cleanExpired(): void {
  const now = Date.now();
  for (const [key, entry] of pkceCache) {
    if (entry.expiresAt < now) {
      pkceCache.delete(key);
    }
  }
}

/** OAuth 处理器配置 */
export interface OAuthOptions {
  config: Config;
  store: Store;
  /** 工具定义列表，OAuth 成功后同步到 Hub */
  tools?: ToolDefinition[];
}

/** 从请求中读取请求体 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

/**
 * 处理 OAuth 安装流程第一步：
 * GET  → 显示配置表单 HTML，让用户填写 Notion Token
 * POST → 读取表单数据，生成 PKCE 并重定向到 Hub 授权页
 * 路由: GET/POST /oauth/setup
 */
export async function handleOAuthStart(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OAuthOptions,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const params = url.searchParams;

  const hub = params.get("hub") ?? opts.config.hubUrl;
  const appId = params.get("app_id") ?? "";
  const botId = params.get("bot_id") ?? "";
  const state = params.get("state") ?? "";
  const returnUrl = params.get("return_url") ?? "";

  // POST 请求 — 用户提交了配置表单
  if (req.method === "POST") {
    const body = await readBody(req);
    const formData = new URLSearchParams(body);
    const notionToken = formData.get("notion_token") || "";
    const notionDatabaseId = formData.get("notion_database_id") || "";

    if (!hub || !appId || !botId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少必填参数: hub, app_id, bot_id" }));
      return;
    }

    // 清理过期缓存
    cleanExpired();

    // 生成 PKCE（base64url 编码）
    const { codeVerifier, codeChallenge } = generatePKCE();
    const localState = crypto.randomUUID();

    // 缓存 PKCE + 用户填的 Key
    pkceCache.set(localState, {
      verifier: codeVerifier,
      hubUrl: hub,
      appId,
      returnUrl,
      userConfig: {
        notion_token: notionToken,
        notion_database_id: notionDatabaseId,
      },
      expiresAt: Date.now() + PKCE_TTL_MS,
    });

    // 构建 Hub 授权 URL: /api/apps/{appId}/oauth/authorize
    const redirectUri = `${opts.config.baseUrl}/oauth/redirect`;
    const authUrl = new URL(`${hub}/api/apps/${appId}/oauth/authorize`);
    authUrl.searchParams.set("bot_id", botId);
    authUrl.searchParams.set("state", localState);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    if (state) authUrl.searchParams.set("hub_state", state);
    if (returnUrl) authUrl.searchParams.set("return_url", returnUrl);

    // 重定向到 Hub 授权页
    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
    return;
  }

  // GET 请求 — 显示配置表单 HTML
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Notion — 配置</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; padding: 32px; max-width: 420px; width: 100%; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .desc { color: #666; font-size: 14px; margin-bottom: 24px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; color: #333; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; margin-bottom: 16px; }
    input:focus { outline: none; border-color: #3370ff; }
    .required::after { content: " *"; color: red; }
    button { width: 100%; padding: 12px; background: #3370ff; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
    button:hover { background: #2860e0; }
    .hint { font-size: 12px; color: #999; margin-top: -12px; margin-bottom: 16px; }
    a { color: #3370ff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Notion</h1>
    <p class="desc">请填写您的 Notion 集成凭证，用于连接 Notion API</p>
    <form method="POST" action="/oauth/setup?hub=${encodeURIComponent(hub)}&app_id=${encodeURIComponent(appId)}&bot_id=${encodeURIComponent(botId)}&state=${encodeURIComponent(state)}&return_url=${encodeURIComponent(returnUrl)}">
      <label class="required">Notion Integration Token</label>
      <input name="notion_token" type="password" placeholder="ntn_xxxxxxxxxxxx" required pattern="ntn_.*" />
      <p class="hint">在 <a href="https://www.notion.com/profile/integrations" target="_blank">Notion Integrations</a> 创建集成后获取，以 ntn_ 开头</p>

      <label>Database ID（可选）</label>
      <input name="notion_database_id" placeholder="32位数据库 ID" />
      <p class="hint">默认写入的数据库 ID，在数据库页面 URL 中获取</p>

      <button type="submit">确认并安装</button>
    </form>
  </div>
</body>
</html>`;

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/**
 * 处理 OAuth 安装流程第二步：用授权码 + code_verifier 换取凭证并保存
 * 路由: GET /oauth/redirect?code=xxx&state=xxx
 * 交换 URL: {hub}/api/apps/{appId}/oauth/exchange
 */
export async function handleOAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OAuthOptions,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const params = url.searchParams;

  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";

  if (!code || !state) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "缺少必填参数: code, state" }));
    return;
  }

  // 清理过期缓存
  cleanExpired();

  // 从缓存取出 PKCE verifier
  const pkceEntry = pkceCache.get(state);
  if (!pkceEntry) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "PKCE 状态无效或已过期" }));
    return;
  }
  pkceCache.delete(state);

  try {
    // 向 Hub 交换凭证: /api/apps/{appId}/oauth/exchange
    const exchangeUrl = `${pkceEntry.hubUrl}/api/apps/${pkceEntry.appId}/oauth/exchange`;
    const exchangeRes = await fetch(exchangeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: pkceEntry.verifier,
      }),
    });

    if (!exchangeRes.ok) {
      const errText = await exchangeRes.text();
      console.error("[oauth] 凭证交换失败:", exchangeRes.status, errText);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "凭证交换失败", detail: errText }));
      return;
    }

    const result = (await exchangeRes.json()) as {
      installation_id: string;
      app_token: string;
      webhook_secret: string;
      bot_id: string;
    };

    // 保存安装信息
    const installation: Installation = {
      id: result.installation_id,
      hubUrl: pkceEntry.hubUrl,
      appId: pkceEntry.appId,
      botId: result.bot_id,
      appToken: result.app_token,
      webhookSecret: result.webhook_secret,
      createdAt: new Date().toISOString(),
    };
    opts.store.saveInstallation(installation);

    console.log("[oauth] 安装成功, installation_id:", result.installation_id);

    // 将用户在 setup 页面填写的 Notion Key 加密存储到本地
    if (pkceEntry.userConfig && Object.values(pkceEntry.userConfig).some((v) => v)) {
      opts.store.saveConfig(installation.id, pkceEntry.userConfig, installation.appToken);
      console.log("[oauth] 用户配置已加密存储");
    }

    // 安装成功后拉取用户配置并加密存储到本地
    {
      const hubClient = new HubClient(installation.hubUrl, installation.appToken);
      try {
        const remoteConfig = await hubClient.fetchConfig();
        if (Object.keys(remoteConfig).length > 0) {
          opts.store.saveConfig(installation.id, remoteConfig, installation.appToken);
          console.log("[oauth] 已拉取并加密保存配置:", installation.id);
        }
      } catch (err) {
        console.error("[oauth] 拉取配置失败:", err);
      }

      // OAuth 成功后同步工具定义到 Hub
      if (opts.tools && opts.tools.length > 0) {
        hubClient.syncTools(opts.tools).catch((err) => {
          console.error("[oauth] 同步工具定义失败:", err);
        });
      }
    }

    // 重定向到 returnUrl（如果有），否则返回成功页面
    if (pkceEntry.returnUrl) {
      res.writeHead(302, { Location: pkceEntry.returnUrl });
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><meta charset="utf-8"><title>安装成功</title></head>
          <body>
            <h1>Notion App 安装成功!</h1>
            <p>Installation ID: ${result.installation_id}</p>
            <p>你可以关闭此页面。</p>
          </body>
        </html>
      `);
    }
  } catch (err) {
    console.error("[oauth] 凭证交换异常:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "凭证交换过程发生异常" }));
  }
}
