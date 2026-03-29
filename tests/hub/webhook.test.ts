/**
 * Webhook 处理器测试
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { handleWebhook, type EventHandler } from "../../src/hub/webhook.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

/** 创建模拟的 IncomingMessage */
function mockRequest(
  method: string,
  body: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const emitter = new EventEmitter() as any;
  emitter.method = method;
  emitter.url = "/hub/webhook";
  emitter.headers = headers;
  // 在下一个 tick 推送数据
  process.nextTick(() => {
    emitter.emit("data", Buffer.from(body));
    emitter.emit("end");
  });
  return emitter as IncomingMessage;
}

/** 创建模拟的 ServerResponse */
function mockResponse(): ServerResponse & { _statusCode: number; _body: string } {
  const res = {
    _statusCode: 0,
    _body: "",
    _headers: {} as Record<string, string>,
    headersSent: false,
    writeHead(statusCode: number, headers?: Record<string, string>) {
      res._statusCode = statusCode;
      if (headers) Object.assign(res._headers, headers);
      return res;
    },
    end(body?: string) {
      res._body = body || "";
      res.headersSent = true;
    },
  };
  return res as any;
}

/** 为 payload 生成 HMAC-SHA256 签名 */
function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** 模拟的 Store */
function mockStore(installations: Record<string, any> = {}) {
  return {
    getInstallation: vi.fn((id: string) => installations[id]),
    saveInstallation: vi.fn(),
    getAllInstallations: vi.fn(() => Object.values(installations)),
    saveMessageLink: vi.fn(),
    getMessageLinkByNotionPage: vi.fn(),
    getLatestLinkByWxUser: vi.fn(),
    close: vi.fn(),
  } as any;
}

describe("handleWebhook", () => {
  const webhookSecret = "test-secret-123";
  const installationId = "inst-001";

  const installations: Record<string, any> = {
    [installationId]: {
      id: installationId,
      hubUrl: "https://hub.example.com",
      appId: "app-001",
      botId: "bot-001",
      appToken: "token-001",
      webhookSecret,
    },
  };

  it("拒绝非 POST 请求（405）", async () => {
    const req = mockRequest("GET", "");
    const res = mockResponse();
    const store = mockStore(installations);

    await handleWebhook(req, res, { store });

    expect(res._statusCode).toBe(405);
  });

  it("空请求体返回 400", async () => {
    const emitter = new EventEmitter() as any;
    emitter.method = "POST";
    emitter.url = "/hub/webhook";
    emitter.headers = {};
    process.nextTick(() => {
      emitter.emit("data", Buffer.from(""));
      emitter.emit("end");
    });

    const res = mockResponse();
    const store = mockStore(installations);

    await handleWebhook(emitter as IncomingMessage, res, { store });

    // 空 body 或者 JSON 解析失败应返回 400
    expect(res._statusCode).toBe(400);
  });

  it("无效 JSON 返回 400", async () => {
    const req = mockRequest("POST", "not-json{{{");
    const res = mockResponse();
    const store = mockStore(installations);

    await handleWebhook(req, res, { store });

    expect(res._statusCode).toBe(400);
  });

  it("未知安装实例返回 404", async () => {
    const body = JSON.stringify({
      type: "event",
      installation_id: "unknown-inst",
      trace_id: "t1",
      bot: { id: "b1" },
    });
    const req = mockRequest("POST", body);
    const res = mockResponse();
    const store = mockStore(installations);

    await handleWebhook(req, res, { store });

    expect(res._statusCode).toBe(404);
  });

  it("签名验证失败返回 401", async () => {
    const body = JSON.stringify({
      type: "event",
      installation_id: installationId,
      trace_id: "t1",
      bot: { id: "b1" },
    });
    const req = mockRequest("POST", body, {
      "x-hub-signature": "invalid-sig",
    });
    const res = mockResponse();
    const store = mockStore(installations);

    await handleWebhook(req, res, { store });

    expect(res._statusCode).toBe(401);
  });

  it("正确处理 challenge 握手", async () => {
    const body = JSON.stringify({
      type: "challenge",
      installation_id: installationId,
      challenge: "test-challenge-value",
      trace_id: "t1",
      bot: { id: "b1" },
    });
    const signature = sign(body, webhookSecret);
    const req = mockRequest("POST", body, {
      "x-hub-signature": signature,
    });
    const res = mockResponse();
    const store = mockStore(installations);

    await handleWebhook(req, res, { store });

    expect(res._statusCode).toBe(200);
    const parsed = JSON.parse(res._body);
    expect(parsed.challenge).toBe("test-challenge-value");
  });

  it("正确分发业务事件并返回 200", async () => {
    const onEvent = vi.fn<EventHandler>();
    const body = JSON.stringify({
      type: "event",
      installation_id: installationId,
      trace_id: "t1",
      bot: { id: "b1" },
      event: {
        type: "message",
        id: "e1",
        timestamp: "2025-01-01T00:00:00Z",
        data: { content: "hello" },
      },
    });
    const signature = sign(body, webhookSecret);
    const req = mockRequest("POST", body, {
      "x-hub-signature": signature,
    });
    const res = mockResponse();
    const store = mockStore(installations);

    await handleWebhook(req, res, { store, onEvent });

    expect(res._statusCode).toBe(200);
    expect(onEvent).toHaveBeenCalledOnce();
  });
});
