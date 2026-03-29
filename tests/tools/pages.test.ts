/**
 * 页面工具测试 — create_page / get_page / update_page / read_page_content
 */
import { describe, it, expect, vi } from "vitest";
import { pageTools } from "../../src/tools/pages.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的 NotionClient */
function mockNotionClient() {
  return {
    createPage: vi.fn().mockResolvedValue({ pageId: "page-001", url: "https://notion.so/page-001" }),
    getPage: vi.fn().mockResolvedValue({
      id: "page-001",
      url: "https://notion.so/page-001",
      created_time: "2025-01-01T00:00:00.000Z",
      last_edited_time: "2025-01-02T00:00:00.000Z",
      archived: false,
      properties: {
        Title: {
          type: "title",
          title: [{ plain_text: "测试页面" }],
        },
        Status: {
          type: "select",
          select: { name: "进行中" },
        },
      },
    }),
    updatePage: vi.fn().mockResolvedValue(undefined),
    getBlocks: vi.fn().mockResolvedValue([
      {
        type: "paragraph",
        paragraph: {
          rich_text: [{ plain_text: "第一段内容" }],
        },
      },
      {
        type: "heading_2",
        heading_2: {
          rich_text: [{ plain_text: "二级标题" }],
        },
      },
      {
        type: "to_do",
        to_do: {
          rich_text: [{ plain_text: "待办事项" }],
          checked: false,
        },
      },
    ]),
    appendBlocks: vi.fn(),
    search: vi.fn(),
    queryDatabase: vi.fn(),
    getDatabase: vi.fn(),
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

describe("pageTools", () => {
  it("定义了 4 个工具", () => {
    expect(pageTools.definitions).toHaveLength(4);
    const names = pageTools.definitions.map((d) => d.name);
    expect(names).toContain("create_page");
    expect(names).toContain("get_page");
    expect(names).toContain("update_page");
    expect(names).toContain("read_page_content");
  });

  describe("create_page", () => {
    it("成功创建页面", async () => {
      const client = mockNotionClient();
      const handlers = pageTools.createHandlers(client);
      const handler = handlers.get("create_page")!;

      const result = await handler(
        makeCtx({ database_id: "db-001", title: "新页面", content: "正文内容" }),
      );

      expect(result).toContain("创建成功");
      expect(result).toContain("page-001");
      expect(client.createPage).toHaveBeenCalledOnce();
    });

    it("缺少 database_id 返回错误", async () => {
      const client = mockNotionClient();
      const handlers = pageTools.createHandlers(client);
      const handler = handlers.get("create_page")!;

      const result = await handler(makeCtx({ title: "新页面" }));
      expect(result).toContain("错误");
      expect(result).toContain("database_id");
    });

    it("缺少 title 返回错误", async () => {
      const client = mockNotionClient();
      const handlers = pageTools.createHandlers(client);
      const handler = handlers.get("create_page")!;

      const result = await handler(makeCtx({ database_id: "db-001" }));
      expect(result).toContain("错误");
      expect(result).toContain("title");
    });
  });

  describe("get_page", () => {
    it("成功获取页面详情", async () => {
      const client = mockNotionClient();
      const handlers = pageTools.createHandlers(client);
      const handler = handlers.get("get_page")!;

      const result = await handler(makeCtx({ page_id: "page-001" }));

      expect(result).toContain("测试页面");
      expect(result).toContain("notion.so");
      expect(client.getPage).toHaveBeenCalledWith("page-001");
    });

    it("缺少 page_id 返回错误", async () => {
      const client = mockNotionClient();
      const handlers = pageTools.createHandlers(client);
      const handler = handlers.get("get_page")!;

      const result = await handler(makeCtx({}));
      expect(result).toContain("错误");
    });
  });

  describe("update_page", () => {
    it("成功更新页面属性", async () => {
      const client = mockNotionClient();
      const handlers = pageTools.createHandlers(client);
      const handler = handlers.get("update_page")!;

      const properties = JSON.stringify({
        Status: { select: { name: "已完成" } },
      });
      const result = await handler(makeCtx({ page_id: "page-001", properties }));

      expect(result).toContain("更新成功");
      expect(client.updatePage).toHaveBeenCalledOnce();
    });

    it("properties 非法 JSON 返回错误", async () => {
      const client = mockNotionClient();
      const handlers = pageTools.createHandlers(client);
      const handler = handlers.get("update_page")!;

      const result = await handler(
        makeCtx({ page_id: "page-001", properties: "not-json{{{" }),
      );
      expect(result).toContain("JSON");
    });
  });

  describe("read_page_content", () => {
    it("成功读取页面内容并格式化", async () => {
      const client = mockNotionClient();
      const handlers = pageTools.createHandlers(client);
      const handler = handlers.get("read_page_content")!;

      const result = await handler(makeCtx({ page_id: "page-001" }));

      expect(result).toContain("3 个块");
      expect(result).toContain("第一段内容");
      expect(result).toContain("二级标题");
      expect(result).toContain("待办事项");
      expect(client.getBlocks).toHaveBeenCalledWith("page-001", 50);
    });

    it("空页面返回提示", async () => {
      const client = mockNotionClient();
      client.getBlocks.mockResolvedValue([]);
      const handlers = pageTools.createHandlers(client);
      const handler = handlers.get("read_page_content")!;

      const result = await handler(makeCtx({ page_id: "page-001" }));
      expect(result).toContain("没有内容");
    });
  });
});
