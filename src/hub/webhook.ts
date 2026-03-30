/**
 * Webhook 事件接收与分发
 *
 * 负责：
 * 1. 接收 Hub 推送的 HTTP POST 请求
 * 2. 处理 url_verification 握手（在签名验证前）
 * 3. 验证 HMAC-SHA256 签名（X-Timestamp + X-Signature，sha256= 前缀）
 * 4. 将业务事件分发给注册的回调函数
 * 5. command 事件支持同步/异步超时响应（SYNC_DEADLINE = 2500ms）
 *    同步回复字段：reply_type / reply_url / reply_base64 / reply_name
 *    Promise.race 使用 Symbol 哨兵区分超时与 null 返回
 */

import { verifySignature } from "../utils/crypto.js";
import type { Store } from "../store.js";
import type { HubEvent, Installation } from "./types.js";
import type { HubClient } from "./client.js";
import type { IncomingMessage, ServerResponse } from "node:http";

/** 同步响应截止时间（毫秒） */
const SYNC_DEADLINE_MS = 2500;

/** 超时哨兵，用于区分 onCommand 返回 null 和真正超时 */
const TIMEOUT_SENTINEL = Symbol("timeout");

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
 * 处理 Webhook 请求（/hub/webhook）
 * 1. 读取并解析 body
 * 2. url_verification 类型直接返回 challenge（无需签名验证）
 * 3. 查找安装实例、验证签名
 * 4. command 事件使用 SYNC_DEADLINE 做同步/异步超时控制
 */
export async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  opts: WebhookOptions,
): Promise<void> {
  try {
    // 读取请求体
    const body = await readBody(req);

    let event: HubEvent;
    try {
      event = JSON.parse(body.toString("utf-8")) as HubEvent;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "请求体 JSON 解析失败" }));
      return;
    }

    // url_verification 握手：在签名验证之前处理
    if (event.type === "url_verification") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ challenge: event.challenge ?? "" }));
      return;
    }

    // 查找安装记录
    const installationId = event.installation_id;
    if (!installationId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少 installation_id" }));
      return;
    }

    const installation = opts.store.getInstallation(installationId);
    if (!installation) {
      console.warn("[webhook] 未找到安装记录:", installationId);
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "安装记录不存在" }));
      return;
    }

    // 验证签名：X-Timestamp + X-Signature
    const timestamp = (req.headers["x-timestamp"] as string) ?? "";
    const signature = (req.headers["x-signature"] as string) ?? "";

    if (!timestamp || !signature) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少签名头: X-Timestamp, X-Signature" }));
      return;
    }

    const valid = verifySignature(
      installation.webhookSecret,
      timestamp,
      body,
      signature,
    );

    if (!valid) {
      console.warn("[webhook] 签名验证失败, installation_id:", installationId);
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "签名验证失败" }));
      return;
    }

    // 分发业务事件
    if (event.event) {
      const eventType = event.event.type;

      // command 事件：Promise.race 2500ms 同步/异步超时处理
      if (eventType === "command" && opts.onCommand) {
        const resultPromise = opts.onCommand(event, installation);
        const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) =>
          setTimeout(() => resolve(TIMEOUT_SENTINEL), SYNC_DEADLINE_MS),
        );
        const raceResult = await Promise.race([resultPromise, timeoutPromise]);

        if (raceResult !== TIMEOUT_SENTINEL) {
          // 在截止时间内拿到结果，同步返回
          const replyBody: Record<string, string> = {
            reply_type: "text",
          };
          if (typeof raceResult === "string") {
            replyBody.reply_base64 = Buffer.from(raceResult, "utf-8").toString("base64");
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(replyBody));
          return;
        }

        // 超时，先返回 reply_async，再异步推送结果
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply_async: true }));

        if (opts.getHubClient) {
          const hubClient = opts.getHubClient(installation);
          resultPromise
            .then(async (asyncResult) => {
              if (asyncResult) {
                // 优先使用 sender.id
                const wSender = (event.event?.data as any)?.sender;
                const userId =
                  (wSender?.id as string) ??
                  (event.event?.data?.user_id as string) ??
                  (event.event?.data?.from as string) ??
                  "";
                if (userId) {
                  try {
                    await hubClient.sendMessage({ userId, text: asyncResult, traceId: event.trace_id });
                  } catch (err) {
                    console.error("[webhook] 异步推送 command 结果失败:", err);
                  }
                }
              }
            })
            .catch((err) => console.error("[webhook] 异步推送 command 结果失败:", err));
        }
        return;
      }

      // 其他事件（message 等）
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
    res.end(JSON.stringify({ status: "ok" }));
  } catch (err) {
    console.error("[webhook] 请求处理异常:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "内部服务器错误" }));
  }
}

/** 请求体最大大小：1MB */
const MAX_BODY_SIZE = 1_048_576;

/** 从 IncomingMessage 读取完整请求体（Buffer），限制最大 1MB */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("请求体超过 1MB 限制"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
