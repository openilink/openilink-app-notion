/**
 * 数据库工具测试 — query_database / get_database_schema / create_database_item
 */
import { describe, it, expect, vi } from "vitest";
import { databaseTools } from "../../src/tools/databases.js";
import type { ToolContext } from "../../src/hub/types.js";

/** 创建模拟的 NotionClient */
function mockNotionClient() {
  return {
    queryDatabase: vi.fn().mockResolvedValue([
      {
        id: "item-001",
        url: "https://notion.so/item-001",
        last_edited_time: "2025-06-01T12:00:00.000Z",
        properties: {
          Name: { type: "title", title: [{ plain_text: "待办事项 A" }] },
        },
      },
      {
        id: "item-002",
        url: "https://notion.so/item-002",
        last_edited_time: "2025-06-02T12:00:00.000Z",
        properties: {
          Name: { type: "title", title: [{ plain_text: "待办事项 B" }] },
        },
      },
    ]),
    getDatabase: vi.fn().mockResolvedValue({
      title: [{ plain_text: "项目管理" }],
      properties: {
        Name: { type: "title" },
        Status: {
          type: "select",
          select: {
            options: [
              { name: "未开始" },
              { name: "进行中" },
              { name: "已完成" },
            ],
          },
        },
        Priority: {
          type: "multi_select",
          multi_select: {
            options: [{ name: "高" }, { name: "中" }, { name: "低" }],
          },
        },
        DueDate: { type: "date" },
      },
    }),
    createPage: vi.fn().mockResolvedValue({ pageId: "item-new", url: "https://notion.so/item-new" }),
    search: vi.fn(),
    getPage: vi.fn(),
    updatePage: vi.fn(),
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

describe("databaseTools", () => {
  it("定义了 3 个工具", () => {
    expect(databaseTools.definitions).toHaveLength(3);
    const names = databaseTools.definitions.map((d) => d.name);
    expect(names).toContain("query_database");
    expect(names).toContain("get_database_schema");
    expect(names).toContain("create_database_item");
  });

  describe("query_database", () => {
    it("成功查询并返回格式化结果", async () => {
      const client = mockNotionClient();
      const handlers = databaseTools.createHandlers(client);
      const handler = handlers.get("query_database")!;

      const result = await handler(makeCtx({ database_id: "db-001" }));

      expect(result).toContain("2 条结果");
      expect(result).toContain("待办事项 A");
      expect(result).toContain("待办事项 B");
      expect(client.queryDatabase).toHaveBeenCalledWith("db-001", undefined, undefined, undefined);
    });

    it("支持过滤和排序参数", async () => {
      const client = mockNotionClient();
      const handlers = databaseTools.createHandlers(client);
      const handler = handlers.get("query_database")!;

      const filter = JSON.stringify({
        property: "Status",
        select: { equals: "进行中" },
      });
      await handler(
        makeCtx({
          database_id: "db-001",
          filter,
          sort_by: "DueDate",
          sort_direction: "ascending",
        }),
      );

      const [dbId, parsedFilter, sorts] = client.queryDatabase.mock.calls[0];
      expect(dbId).toBe("db-001");
      expect(parsedFilter).toEqual({
        property: "Status",
        select: { equals: "进行中" },
      });
      expect(sorts).toEqual([{ property: "DueDate", direction: "ascending" }]);
    });

    it("空结果返回提示", async () => {
      const client = mockNotionClient();
      client.queryDatabase.mockResolvedValue([]);
      const handlers = databaseTools.createHandlers(client);
      const handler = handlers.get("query_database")!;

      const result = await handler(makeCtx({ database_id: "db-001" }));
      expect(result).toContain("为空");
    });

    it("缺少 database_id 返回错误", async () => {
      const client = mockNotionClient();
      const handlers = databaseTools.createHandlers(client);
      const handler = handlers.get("query_database")!;

      const result = await handler(makeCtx({}));
      expect(result).toContain("错误");
    });
  });

  describe("get_database_schema", () => {
    it("成功获取数据库结构", async () => {
      const client = mockNotionClient();
      const handlers = databaseTools.createHandlers(client);
      const handler = handlers.get("get_database_schema")!;

      const result = await handler(makeCtx({ database_id: "db-001" }));

      expect(result).toContain("项目管理");
      expect(result).toContain("Name");
      expect(result).toContain("title");
      expect(result).toContain("Status");
      expect(result).toContain("select");
      expect(result).toContain("未开始");
      expect(result).toContain("进行中");
      expect(result).toContain("已完成");
      expect(client.getDatabase).toHaveBeenCalledWith("db-001");
    });

    it("缺少 database_id 返回错误", async () => {
      const client = mockNotionClient();
      const handlers = databaseTools.createHandlers(client);
      const handler = handlers.get("get_database_schema")!;

      const result = await handler(makeCtx({}));
      expect(result).toContain("错误");
    });
  });

  describe("create_database_item", () => {
    it("成功创建条目", async () => {
      const client = mockNotionClient();
      const handlers = databaseTools.createHandlers(client);
      const handler = handlers.get("create_database_item")!;

      const result = await handler(
        makeCtx({ database_id: "db-001", title: "新任务" }),
      );

      expect(result).toContain("创建成功");
      expect(result).toContain("新任务");
      expect(result).toContain("item-new");
      expect(client.createPage).toHaveBeenCalledWith("db-001", "新任务", undefined);
    });

    it("支持额外属性参数", async () => {
      const client = mockNotionClient();
      const handlers = databaseTools.createHandlers(client);
      const handler = handlers.get("create_database_item")!;

      const properties = JSON.stringify({
        Status: { select: { name: "进行中" } },
      });
      await handler(
        makeCtx({ database_id: "db-001", title: "新任务", properties }),
      );

      const [, , extraProps] = client.createPage.mock.calls[0];
      expect(extraProps).toEqual({ Status: { select: { name: "进行中" } } });
    });

    it("缺少 title 返回错误", async () => {
      const client = mockNotionClient();
      const handlers = databaseTools.createHandlers(client);
      const handler = handlers.get("create_database_item")!;

      const result = await handler(makeCtx({ database_id: "db-001" }));
      expect(result).toContain("错误");
      expect(result).toContain("title");
    });
  });
});
