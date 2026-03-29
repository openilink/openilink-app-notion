/**
 * 搜索工具测试 — search_notion
 */
import { describe, it, expect, vi } from "vitest";
import { searchTools } from "../../src/tools/search.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的 NotionClient */
function mockNotionClient() {
  return {
    search: vi.fn().mockResolvedValue([
      {
        id: "page-001",
        object: "page",
        url: "https://notion.so/page-001",
        last_edited_time: "2025-06-01T12:00:00.000Z",
        properties: {
          Name: { type: "title", title: [{ plain_text: "项目文档" }] },
        },
      },
      {
        id: "db-001",
        object: "database",
        url: "https://notion.so/db-001",
        last_edited_time: "2025-05-15T08:00:00.000Z",
        title: [{ plain_text: "任务数据库" }],
      },
    ]),
    createPage: vi.fn(),
    getPage: vi.fn(),
    updatePage: vi.fn(),
    queryDatabase: vi.fn(),
    getDatabase: vi.fn(),
    getBlocks: vi.fn(),
    appendBlocks: vi.fn(),
    deleteBlock: vi.fn(),
    listComments: vi.fn(),
    createComment: vi.fn(),
    listUsers: vi.fn(),
    getMe: vi.fn(),
  } as any;
}

/** 构建 ToolContext */
function makeCtx(args: Record<string, unknown>): ToolContext {
  return {
    installationId: "inst-001",
    botId: "bot-001",
    userId: "user-001",
    traceId: "trace-001",
    args,
  };
}

describe("searchTools", () => {
  it("定义了 1 个工具 search_notion", () => {
    expect(searchTools.definitions).toHaveLength(1);
    expect(searchTools.definitions[0].name).toBe("search_notion");
  });

  describe("search_notion", () => {
    it("成功搜索并返回格式化结果", async () => {
      const client = mockNotionClient();
      const handlers = searchTools.createHandlers(client);
      const handler = handlers.get("search_notion")!;

      const result = await handler(makeCtx({ query: "项目" }));

      expect(result).toContain("2 条结果");
      expect(result).toContain("项目文档");
      expect(result).toContain("任务数据库");
      expect(result).toContain("页面");
      expect(result).toContain("数据库");
      expect(client.search).toHaveBeenCalledWith("项目", undefined, 10);
    });

    it("支持按类型过滤", async () => {
      const client = mockNotionClient();
      const handlers = searchTools.createHandlers(client);
      const handler = handlers.get("search_notion")!;

      await handler(makeCtx({ query: "测试", type: "page" }));

      expect(client.search).toHaveBeenCalledWith("测试", "page", 10);
    });

    it("支持自定义返回数量", async () => {
      const client = mockNotionClient();
      const handlers = searchTools.createHandlers(client);
      const handler = handlers.get("search_notion")!;

      await handler(makeCtx({ query: "测试", count: 5 }));

      expect(client.search).toHaveBeenCalledWith("测试", undefined, 5);
    });

    it("无结果时返回提示", async () => {
      const client = mockNotionClient();
      client.search.mockResolvedValue([]);
      const handlers = searchTools.createHandlers(client);
      const handler = handlers.get("search_notion")!;

      const result = await handler(makeCtx({ query: "不存在的内容" }));

      expect(result).toContain("未找到");
      expect(result).toContain("不存在的内容");
    });

    it("缺少 query 返回错误", async () => {
      const client = mockNotionClient();
      const handlers = searchTools.createHandlers(client);
      const handler = handlers.get("search_notion")!;

      const result = await handler(makeCtx({}));
      expect(result).toContain("错误");
      expect(result).toContain("query");
    });

    it("API 异常时返回错误信息", async () => {
      const client = mockNotionClient();
      client.search.mockRejectedValue(new Error("Notion API 限流"));
      const handlers = searchTools.createHandlers(client);
      const handler = handlers.get("search_notion")!;

      const result = await handler(makeCtx({ query: "test" }));
      expect(result).toContain("搜索失败");
      expect(result).toContain("Notion API 限流");
    });
  });
});
