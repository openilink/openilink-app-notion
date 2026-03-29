/**
 * Webhook 事件接收与分发
 *
 * 负责：
 * 1. 接收 Hub 推送的 HTTP POST 请求
 * 2. 验证 HMAC-SHA256 签名
 * 3. 处理 challenge 握手
 * 4. 将业务事件分发给注册的回调函数
 * 5. command 事件支持同步/异步超时响应（SYNC_DEADLINE = 2500ms）
 */

import { verifySignature } from "../utils/crypto.js";
import type { Store } from "../store.js";
import type { HubEvent, Installation } from "./types.js";
import type { HubClient } from "./client.js";
import type { IncomingMessage, ServerResponse } from "node:http";

/** 同步响应截止时间（毫秒） */
const SYNC_DEADLINE_MS = 2500;

/** 普通事件处理回调（无返回值） */
export type EventHandler = (event: HubEvent) => Promise<void>;

/** command 事件处理回调（返回结果文本） */
export type CommandHandler = (event: HubEvent, installation: Installation) => Promise<string | null>;

/** 获取 HubClient 实例的工厂函数 */
export type HubClientFactory = (installation: Installation) => HubClient;

/** Webhook 处理器配置 */
export interface WebhookOptions {
  store: Store;
  /** 普通事件回调（message 等） */
  onEvent?: EventHandler;
  /** command 事件回调，返回工具执行结果 */
  onCommand?: CommandHandler;
  /** 获取 HubClient 工厂，用于超时后异步回复 */
  getHubClient?: HubClientFactory;
}

/**
 * 处理 Webhook 请求（/webhook）
 * 验证签名 → 处理 challenge → 分发事件
 * command 事件使用 SYNC_DEADLINE 做同步/异步超时控制
 */
export async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  opts: WebhookOptions,
): Promise<void> {
  // 仅接受 POST 请求
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "仅支持 POST 请求" }));
    return;
  }

  // 读取请求体
  const body = await readBody(req);
  if (!body) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "请求体为空" }));
    return;
  }

  // 解析事件
  let event: HubEvent;
  try {
    event = JSON.parse(body) as HubEvent;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "JSON 解析失败" }));
    return;
  }

  // 查找对应的安装实例以获取签名密钥
  const installation = opts.store.getInstallation(event.installation_id);
  if (!installation) {
    console.warn("[webhook] 未知安装实例:", event.installation_id);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "未知的安装实例" }));
    return;
  }

  // 验证签名
  const signature = req.headers["x-hub-signature"] as string | undefined;
  if (!signature || !verifySignature(body, signature, installation.webhookSecret)) {
    console.warn("[webhook] 签名验证失败:", event.installation_id);
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "签名验证失败" }));
    return;
  }

  // 处理 challenge 握手
  if (event.type === "challenge" && event.challenge) {
    console.log("[webhook] 握手成功:", event.installation_id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ challenge: event.challenge }));
    return;
  }

  // 分发业务事件
  if (event.type === "event") {
    const subType = event.event?.type;

    // command 事件：同步/异步超时处理
    if (subType === "command" && opts.onCommand) {
      const resultPromise = opts.onCommand(event, installation);
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), SYNC_DEADLINE_MS),
      );
      const result = await Promise.race([resultPromise, timeoutPromise]);

      if (result !== null) {
        // 在截止时间内拿到结果，同步返回
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply: result }));
        return;
      }

      // 超时，通过 replyToolResult 异步推送工具执行结果
      if (opts.getHubClient) {
        const hubClient = opts.getHubClient(installation);
        resultPromise
          .then(async (asyncResult) => {
            if (asyncResult) {
              await hubClient.replyToolResult(event.trace_id, asyncResult);
            }
          })
          .catch((err) => console.error("[webhook] 异步回复 command 失败:", err));
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply_async: true }));
      return;
    }

    // 其他事件（message 等）：原有逻辑
    if (opts.onEvent) {
      try {
        await opts.onEvent(event);
      } catch (err) {
        console.error("[webhook] 事件处理失败:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "事件处理失败" }));
        return;
      }
    }
  }

  // 返回成功
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

/** 从 IncomingMessage 读取完整请求体 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
