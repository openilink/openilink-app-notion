/**
 * HubClient 测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HubClient } from "../../src/hub/client.js";

describe("HubClient", () => {
  const hubUrl = "https://hub.example.com";
  const appToken = "test-app-token";
  let client: HubClient;

  /** 保存原始 fetch 并在每次测试后恢复 */
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new HubClient(hubUrl, appToken);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("构造函数去除末尾斜杠", () => {
    const c = new HubClient("https://hub.example.com///", appToken);
    // 通过发送请求来验证 URL 拼接是否正确
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve({ ok: true, data: { messageId: "m1" } }),
    });

    c.sendMessage({ userId: "u1", text: "hi" });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      "https://hub.example.com/api/bot/message",
      expect.any(Object),
    );
  });

  it("sendMessage 发送正确的请求", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve({ ok: true, data: { messageId: "m1" } }),
    });

    const result = await client.sendMessage({
      userId: "user-001",
      text: "测试消息",
      traceId: "trace-001",
    });

    expect(result).toEqual({ messageId: "m1" });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${hubUrl}/api/bot/message`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${appToken}`,
        }),
      }),
    );

    // 检查请求体
    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse((callArgs[1] as any).body);
    expect(body.user_id).toBe("user-001");
    expect(body.text).toBe("测试消息");
    expect(body.trace_id).toBe("trace-001");
  });

  it("replyToolResult 发送正确的请求", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve({ ok: true }),
    });

    await client.replyToolResult("trace-001", "执行成功");

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${hubUrl}/api/bot/tool-result`,
      expect.any(Object),
    );

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse((callArgs[1] as any).body);
    expect(body.trace_id).toBe("trace-001");
    expect(body.result).toBe("执行成功");
  });

  it("HTTP 错误时抛出异常", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    await expect(
      client.sendMessage({ userId: "u1", text: "hi" }),
    ).rejects.toThrow("Hub API 请求失败");
  });

  it("业务错误时抛出异常", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve({ ok: false, error: "用户不存在" }),
    });

    await expect(
      client.sendMessage({ userId: "u1", text: "hi" }),
    ).rejects.toThrow("用户不存在");
  });

  it("registerTools 发送 PUT 请求", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
    });

    const tools = [
      { name: "search_notion", description: "搜索", command: "search_notion" },
    ];
    await client.registerTools(tools);

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `${hubUrl}/api/bot/tools`,
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
