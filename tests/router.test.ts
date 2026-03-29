/**
 * Router 命令路由器测试
 */
import { describe, it, expect, vi } from "vitest";
import { Router } from "../src/router.js";
import type { HubEvent, ToolDefinition, ToolHandler } from "../src/hub/types.js";

/** 创建模拟的 Store */
function mockStore() {
  return {
    getInstallation: vi.fn(),
    saveInstallation: vi.fn(),
    getAllInstallations: vi.fn(),
    saveMessageLink: vi.fn(),
    getMessageLinkByNotionPage: vi.fn(),
    getLatestLinkByWxUser: vi.fn(),
    close: vi.fn(),
  } as any;
}

/** 创建测试用的工具定义和处理函数 */
function createTestTools() {
  const definitions: ToolDefinition[] = [
    { name: "search_notion", description: "搜索 Notion", command: "search_notion" },
    { name: "create_page", description: "创建页面", command: "create_page" },
  ];

  const handlers = new Map<string, ToolHandler>();
  handlers.set("search_notion", vi.fn().mockResolvedValue("搜索结果：找到 3 条"));
  handlers.set("create_page", vi.fn().mockResolvedValue("页面创建成功"));

  return { definitions, handlers };
}

/** 构建一个 command 类型的 HubEvent */
function makeCommandEvent(
  command: string,
  args: Record<string, unknown> = {},
): HubEvent {
  return {
    v: "1",
    type: "event",
    trace_id: "trace-001",
    installation_id: "inst-001",
    bot: { id: "bot-001" },
    event: {
      type: "command",
      id: "evt-001",
      timestamp: "2025-01-01T00:00:00Z",
      data: {
        command,
        args,
        user_id: "user-001",
      },
    },
  };
}

describe("Router", () => {
  describe("handleCommand", () => {
    it("正确路由到对应的工具处理函数", async () => {
      const { definitions, handlers } = createTestTools();
      const router = new Router({ definitions, handlers, store: mockStore() });

      const event = makeCommandEvent("search_notion", { query: "测试" });
      const result = await router.handleCommand(event);

      expect(result).toBe("搜索结果：找到 3 条");
      expect(handlers.get("search_notion")).toHaveBeenCalledOnce();
    });

    it("传递正确的 ToolContext 给处理函数", async () => {
      const { definitions, handlers } = createTestTools();
      const router = new Router({ definitions, handlers, store: mockStore() });

      const event = makeCommandEvent("search_notion", { query: "hello" });
      await router.handleCommand(event);

      const ctx = (handlers.get("search_notion") as any).mock.calls[0][0];
      expect(ctx.installationId).toBe("inst-001");
      expect(ctx.botId).toBe("bot-001");
      expect(ctx.userId).toBe("user-001");
      expect(ctx.traceId).toBe("trace-001");
      expect(ctx.args).toEqual({ query: "hello" });
    });

    it("未知命令返回提示信息", async () => {
      const { definitions, handlers } = createTestTools();
      const router = new Router({ definitions, handlers, store: mockStore() });

      const event = makeCommandEvent("unknown_command");
      const result = await router.handleCommand(event);

      expect(result).toContain("未知命令");
      expect(result).toContain("unknown_command");
    });

    it("非 event 类型返回 undefined", async () => {
      const { definitions, handlers } = createTestTools();
      const router = new Router({ definitions, handlers, store: mockStore() });

      const event: HubEvent = {
        v: "1",
        type: "challenge",
        trace_id: "t1",
        installation_id: "inst-001",
        bot: { id: "b1" },
        challenge: "test",
      };

      const result = await router.handleCommand(event);
      expect(result).toBeUndefined();
    });

    it("非 command 子类型返回 undefined", async () => {
      const { definitions, handlers } = createTestTools();
      const router = new Router({ definitions, handlers, store: mockStore() });

      const event: HubEvent = {
        v: "1",
        type: "event",
        trace_id: "t1",
        installation_id: "inst-001",
        bot: { id: "b1" },
        event: {
          type: "message",
          id: "e1",
          timestamp: "2025-01-01T00:00:00Z",
          data: { content: "hello" },
        },
      };

      const result = await router.handleCommand(event);
      expect(result).toBeUndefined();
    });

    it("处理函数抛出异常时返回错误消息", async () => {
      const definitions: ToolDefinition[] = [
        { name: "broken_tool", description: "会报错的工具", command: "broken_tool" },
      ];
      const handlers = new Map<string, ToolHandler>();
      handlers.set("broken_tool", vi.fn().mockRejectedValue(new Error("Notion API 限流")));

      const router = new Router({ definitions, handlers, store: mockStore() });
      const event = makeCommandEvent("broken_tool");
      const result = await router.handleCommand(event);

      expect(result).toContain("命令执行失败");
      expect(result).toContain("Notion API 限流");
    });
  });

  describe("getDefinitions", () => {
    it("返回所有已注册的工具定义", () => {
      const { definitions, handlers } = createTestTools();
      const router = new Router({ definitions, handlers, store: mockStore() });

      const defs = router.getDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs[0].name).toBe("search_notion");
      expect(defs[1].name).toBe("create_page");
    });
  });

  describe("handleAndReply", () => {
    it("执行命令并通过 HubClient 回传结果", async () => {
      const { definitions, handlers } = createTestTools();
      const router = new Router({ definitions, handlers, store: mockStore() });

      const mockHubClient = {
        replyToolResult: vi.fn().mockResolvedValue(undefined),
      } as any;

      const event = makeCommandEvent("search_notion", { query: "test" });
      await router.handleAndReply(event, mockHubClient);

      expect(mockHubClient.replyToolResult).toHaveBeenCalledWith(
        "trace-001",
        "搜索结果：找到 3 条",
      );
    });

    it("非命令事件不调用 HubClient", async () => {
      const { definitions, handlers } = createTestTools();
      const router = new Router({ definitions, handlers, store: mockStore() });

      const mockHubClient = {
        replyToolResult: vi.fn(),
      } as any;

      const event: HubEvent = {
        v: "1",
        type: "challenge",
        trace_id: "t1",
        installation_id: "inst-001",
        bot: { id: "b1" },
      };

      await router.handleAndReply(event, mockHubClient);
      expect(mockHubClient.replyToolResult).not.toHaveBeenCalled();
    });
  });
});
