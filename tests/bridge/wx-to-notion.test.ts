/**
 * WxToNotion 微信消息转 Notion 测试
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WxToNotion } from "../../src/bridge/wx-to-notion.js";

/** 创建模拟的 NotionClient */
function mockNotionClient() {
  return {
    createPage: vi.fn().mockResolvedValue({ pageId: "page-new", url: "https://notion.so/page-new" }),
    appendBlocks: vi.fn().mockResolvedValue(undefined),
    search: vi.fn(),
    getPage: vi.fn(),
    updatePage: vi.fn(),
    queryDatabase: vi.fn(),
    getDatabase: vi.fn(),
    getBlocks: vi.fn(),
    deleteBlock: vi.fn(),
    listComments: vi.fn(),
    createComment: vi.fn(),
    listUsers: vi.fn(),
    getMe: vi.fn(),
  } as any;
}

/** 创建模拟的 Store */
function mockStore(existingLink: any = null) {
  return {
    saveMessageLink: vi.fn(),
    getMessageLinkByNotionPage: vi.fn().mockReturnValue(null),
    getLatestLinkByWxUser: vi.fn().mockReturnValue(existingLink),
    getAllInstallations: vi.fn().mockReturnValue([]),
  } as any;
}

const mockInstallation = {
  id: "inst-001",
  hubUrl: "https://hub.example.com",
  appId: "app-001",
  botId: "bot-001",
  appToken: "token-001",
  webhookSecret: "secret-001",
};

describe("WxToNotion", () => {
  describe("新用户 → 创建页面", () => {
    it("为没有关联记录的用户创建新 Notion 页面", async () => {
      const client = mockNotionClient();
      const store = mockStore(null); // 没有已有关联
      const bridge = new WxToNotion(client, store, "db-001");

      const event = {
        type: "message" as const,
        fromId: "wx-001",
        fromName: "张三",
        content: "你好世界",
        timestamp: Date.now(),
      };

      await bridge.handleWxEvent(event, mockInstallation);

      // 应该调用 createPage
      expect(client.createPage).toHaveBeenCalledOnce();
      const [dbId, title] = client.createPage.mock.calls[0];
      expect(dbId).toBe("db-001");
      expect(title).toContain("张三");

      // 应该保存消息关联
      expect(store.saveMessageLink).toHaveBeenCalledOnce();
      const savedLink = store.saveMessageLink.mock.calls[0][0];
      expect(savedLink.notionPageId).toBe("page-new");
      expect(savedLink.wxUserId).toBe("wx-001");
    });
  });

  describe("已有用户 → 追加内容", () => {
    it("对已有关联记录的用户追加消息到现有页面", async () => {
      const existingLink = {
        installationId: "inst-001",
        notionPageId: "page-existing",
        notionBlockId: "block-001",
        wxUserId: "wx-001",
        wxUserName: "张三",
      };
      const client = mockNotionClient();
      const store = mockStore(existingLink);
      const bridge = new WxToNotion(client, store, "db-001");

      const event = {
        type: "message" as const,
        fromId: "wx-001",
        fromName: "张三",
        content: "追加的消息",
        timestamp: Date.now(),
      };

      await bridge.handleWxEvent(event, mockInstallation);

      // 应该调用 appendBlocks 而不是 createPage
      expect(client.appendBlocks).toHaveBeenCalledOnce();
      expect(client.createPage).not.toHaveBeenCalled();

      const [pageId, blocks] = client.appendBlocks.mock.calls[0];
      expect(pageId).toBe("page-existing");
      expect(blocks).toHaveLength(1);
      expect(blocks[0].paragraph.rich_text[0].text.content).toContain("追加的消息");
    });
  });

  describe("事件过滤", () => {
    it("跳过 command 类型事件", async () => {
      const client = mockNotionClient();
      const store = mockStore(null);
      const bridge = new WxToNotion(client, store);

      const event = {
        type: "command" as const,
        fromId: "wx-001",
        fromName: "张三",
        content: "/search test",
        timestamp: Date.now(),
      };

      await bridge.handleWxEvent(event, mockInstallation);

      expect(client.createPage).not.toHaveBeenCalled();
      expect(client.appendBlocks).not.toHaveBeenCalled();
    });

    it("忽略非 message 类型事件", async () => {
      const client = mockNotionClient();
      const store = mockStore(null);
      const bridge = new WxToNotion(client, store);

      const event = {
        type: "unknown" as any,
        fromId: "wx-001",
        fromName: "张三",
        content: "test",
        timestamp: Date.now(),
      };

      await bridge.handleWxEvent(event, mockInstallation);

      expect(client.createPage).not.toHaveBeenCalled();
      expect(client.appendBlocks).not.toHaveBeenCalled();
    });
  });
});
