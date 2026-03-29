/**
 * OAuth PKCE 授权流程处理
 *
 * 流程：
 * 1. 用户访问 /oauth/start → 生成 PKCE 码对，重定向到 Hub 授权页
 * 2. Hub 回调 /oauth/callback?code=xxx → 用 code + code_verifier 换取 token
 * 3. 将安装信息持久化到 Store
 */

import { generatePKCE } from "../utils/crypto.js";
import type { Store } from "../store.js";
import type { Config } from "../config.js";
import type { Installation, ToolDefinition } from "./types.js";
import { HubClient } from "./client.js";
import type { IncomingMessage, ServerResponse } from "node:http";

/** 内存中暂存 PKCE state → verifier 映射（生产环境应使用 Redis 等） */
const pendingStates = new Map<string, { codeVerifier: string; createdAt: number }>();

/** 定期清理过期 state（5 分钟过期） */
const STATE_TTL_MS = 5 * 60 * 1000;

/** OAuth 处理器配置 */
export interface OAuthOptions {
  config: Config;
  store: Store;
  /** 工具定义列表，OAuth 成功后同步到 Hub */
  tools?: ToolDefinition[];
}

/**
 * 处理 OAuth 启动请求（/oauth/start）
 * 生成 PKCE 码对并重定向到 Hub 授权页面
 */
export function handleOAuthStart(
  _req: IncomingMessage,
  res: ServerResponse,
  opts: OAuthOptions,
): void {
  const { codeVerifier, codeChallenge } = generatePKCE();

  // 生成随机 state 防止 CSRF
  const state = crypto.randomUUID();
  pendingStates.set(state, { codeVerifier, createdAt: Date.now() });

  // 清理过期 state
  cleanupExpiredStates();

  const redirectUrl = new URL("/oauth/authorize", opts.config.hubUrl);
  redirectUrl.searchParams.set("response_type", "code");
  redirectUrl.searchParams.set("redirect_uri", `${opts.config.baseUrl}/oauth/redirect`);
  redirectUrl.searchParams.set("state", state);
  redirectUrl.searchParams.set("code_challenge", codeChallenge);
  redirectUrl.searchParams.set("code_challenge_method", "S256");

  res.writeHead(302, { Location: redirectUrl.toString() });
  res.end();
}

/**
 * 处理 OAuth 回调请求（/oauth/callback）
 * 用授权码 + code_verifier 换取访问令牌
 */
export async function handleOAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OAuthOptions,
): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // 参数校验
  if (!code || !state) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "缺少 code 或 state 参数" }));
    return;
  }

  // 验证并获取 PKCE verifier
  const pending = pendingStates.get(state);
  if (!pending) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "state 无效或已过期" }));
    return;
  }
  pendingStates.delete(state);

  try {
    // 向 Hub 换取 token
    const tokenUrl = new URL("/oauth/token", opts.config.hubUrl);
    const tokenResp = await fetch(tokenUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${opts.config.baseUrl}/oauth/redirect`,
        code_verifier: pending.codeVerifier,
      }),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error("[oauth] 换取 token 失败:", tokenResp.status, errText);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "换取 token 失败", detail: errText }));
      return;
    }

    const tokenData = (await tokenResp.json()) as {
      installation_id: string;
      app_id: string;
      bot_id: string;
      app_token: string;
      webhook_secret: string;
    };

    // 持久化安装信息
    const installation: Installation = {
      id: tokenData.installation_id,
      hubUrl: opts.config.hubUrl,
      appId: tokenData.app_id,
      botId: tokenData.bot_id,
      appToken: tokenData.app_token,
      webhookSecret: tokenData.webhook_secret,
      createdAt: new Date().toISOString(),
    };
    opts.store.saveInstallation(installation);

    console.log("[oauth] 安装成功:", installation.id);

    // OAuth 成功后同步工具定义到 Hub
    if (opts.tools && opts.tools.length > 0) {
      const hubClient = new HubClient(installation.hubUrl, installation.appToken);
      hubClient.syncTools(opts.tools).catch((err) => {
        console.error("[oauth] 同步工具定义失败:", err);
      });
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, installation_id: installation.id }));
  } catch (err) {
    console.error("[oauth] 回调处理异常:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "内部错误" }));
  }
}

/** 清理已过期的 PKCE state */
function cleanupExpiredStates(): void {
  const now = Date.now();
  for (const [key, value] of pendingStates) {
    if (now - value.createdAt > STATE_TTL_MS) {
      pendingStates.delete(key);
    }
  }
}
