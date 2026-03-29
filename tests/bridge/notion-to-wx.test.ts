/**
 * NotionToWx 变更通知测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotionToWx } from "../../src/bridge/notion-to-wx.js";
import type { NotionChangeEvent } from "../../src/notion/event.js";

/** 保存原始 fetch */
const originalFetch = globalThis.fetch;

/** 创建模拟的 Store */
function mockStore(link: any = null) {
  return {
    saveMessageLink: vi.fn(),
    getMessageLinkByNotionPage: vi.fn().mockReturnValue(link),
    getLatestLinkByWxUser: vi.fn(),
    getAllInstallations: vi.fn().mockReturnValue([]),
  } as any;
}

const testInstallation = {
  id: "inst-001",
  hubUrl: "https://hub.example.com",
  appId: "app-001",
  botId: "bot-001",
  appToken: "token-001",
  webhookSecret: "secret-001",
};

describe("NotionToWx", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("找到关联的微信用户时发送通知", async () => {
    const link = {
      installationId: "inst-001",
      notionPageId: "page-001",
      notionBlockId: "block-001",
      wxUserId: "wx-user-001",
      wxUserName: "张三",
    };
    const store = mockStore(link);
    const notionToWx = new NotionToWx(store);

    // 模拟 fetch（发送通知到 Hub）
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const changeEvent: NotionChangeEvent = {
      pageId: "page-001",
      title: "测试页面",
      lastEditedTime: "2025-06-01T12:00:00.000Z",
      url: "https://www.notion.so/page-001",
    };

    await notionToWx.handleNotionChange(changeEvent, [testInstallation]);

    // 应该查询了消息关联
    expect(store.getMessageLinkByNotionPage).toHaveBeenCalledWith("page-001");

    // 应该向 Hub API 发送了消息
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledOnce();
    const [url, opts] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toContain("hub.example.com");
    const body = JSON.parse((opts as any).body);
    expect(body.toUserId).toBe("wx-user-001");
    expect(body.content).toContain("测试页面");
  });

  it("没有关联用户时不发送通知", async () => {
    const store = mockStore(null); // 没有关联记录
    const notionToWx = new NotionToWx(store);

    globalThis.fetch = vi.fn();

    const changeEvent: NotionChangeEvent = {
      pageId: "page-orphan",
      title: "孤立页面",
      lastEditedTime: "2025-06-01T12:00:00.000Z",
      url: "https://www.notion.so/page-orphan",
    };

    await notionToWx.handleNotionChange(changeEvent, [testInstallation]);

    // 不应该调用 fetch
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it("找不到对应安装实例时不发送通知", async () => {
    const link = {
      installationId: "inst-unknown", // 不在 installations 列表中
      notionPageId: "page-001",
      notionBlockId: "block-001",
      wxUserId: "wx-user-001",
      wxUserName: "张三",
    };
    const store = mockStore(link);
    const notionToWx = new NotionToWx(store);

    globalThis.fetch = vi.fn();

    const changeEvent: NotionChangeEvent = {
      pageId: "page-001",
      title: "测试页面",
      lastEditedTime: "2025-06-01T12:00:00.000Z",
      url: "https://www.notion.so/page-001",
    };

    await notionToWx.handleNotionChange(changeEvent, [testInstallation]);

    // 不应该调用 fetch
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it("通知消息包含页面标题和链接", async () => {
    const link = {
      installationId: "inst-001",
      notionPageId: "page-001",
      notionBlockId: "block-001",
      wxUserId: "wx-user-001",
      wxUserName: "张三",
    };
    const store = mockStore(link);
    const notionToWx = new NotionToWx(store);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const changeEvent: NotionChangeEvent = {
      pageId: "page-001",
      title: "会议纪要",
      lastEditedTime: "2025-06-15T10:30:00.000Z",
      url: "https://www.notion.so/meeting-notes",
    };

    await notionToWx.handleNotionChange(changeEvent, [testInstallation]);

    const body = JSON.parse(
      (vi.mocked(globalThis.fetch).mock.calls[0][1] as any).body,
    );
    expect(body.content).toContain("会议纪要");
    expect(body.content).toContain("https://www.notion.so/meeting-notes");
  });
});
