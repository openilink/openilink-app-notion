/**
 * Notion Bridge 集成测试
 *
 * 测试 Hub <-> App 的完整通信链路，不依赖真实 Notion API：
 * 1. Mock Hub Server 模拟 OpeniLink Hub
 * 2. 创建轻量 App HTTP 服务器（仅含 webhook handler）
 * 3. 使用内存 SQLite 存储 + Mock NotionClient
 * 4. 验证微信->Notion 和 Notion->微信 的双向桥接
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import { Store } from "../../src/store.js";
import { handleWebhook } from "../../src/hub/webhook.js";
import { WxToNotion } from "../../src/bridge/wx-to-notion.js";
import { NotionToWx } from "../../src/bridge/notion-to-wx.js";
import type { NotionChangeEvent } from "../../src/notion/event.js";
import type { HubEvent as RawHubEvent } from "../../src/hub/types.js";
import {
  startMockHub,
  injectMessage,
  getMessages,
  resetMock,
  waitFor,
  MOCK_HUB_URL,
  MOCK_WEBHOOK_SECRET,
  MOCK_APP_TOKEN,
  MOCK_INSTALLATION_ID,
  MOCK_BOT_ID,
  APP_PORT,
} from "./setup.js";

// ─── Mock NotionClient ───
// 模拟 Notion 客户端，不连接真实 Notion API，仅记录调用

/** 记录 createPage 调用 */
let notionCreatedPages: Array<{
  databaseId: string;
  title: string;
  content?: string;
  pageId: string;
}> = [];

/** 记录 appendBlocks 调用 */
let notionAppendedBlocks: Array<{
  blockId: string;
  children: any[];
}> = [];

/** 页面 ID 计数器 */
let notionPageIdCounter = 0;

/**
 * 创建 Mock NotionClient
 * 实现 createPage / appendBlocks 方法，返回模拟数据
 */
function createMockNotionClient() {
  return {
    sdk: {} as any,
    defaultDatabaseId: "mock-db-001",
    createPage: async (
      databaseId: string,
      title: string,
      _properties?: Record<string, any>,
      content?: string,
    ): Promise<{ pageId: string; url: string }> => {
      notionPageIdCounter++;
      const pageId = `notion_page_${notionPageIdCounter}`;
      notionCreatedPages.push({ databaseId, title, content, pageId });
      return {
        pageId,
        url: `https://notion.so/${pageId}`,
      };
    },
    appendBlocks: async (blockId: string, children: any[]): Promise<void> => {
      notionAppendedBlocks.push({ blockId, children });
    },
    getPage: async (pageId: string): Promise<any> => ({
      id: pageId,
      url: `https://notion.so/${pageId}`,
      properties: {
        Name: { type: "title", title: [{ plain_text: "Mock Page" }] },
      },
    }),
    queryDatabase: async (): Promise<any[]> => [],
    search: async (): Promise<any[]> => [],
  };
}

// ─── 测试主体 ───

describe("Notion Bridge 集成测试", () => {
  let mockHubHandle: { server: http.Server; close: () => Promise<void> };
  let appServer: http.Server;
  let store: Store;
  let wxToNotion: WxToNotion;
  let notionToWx: NotionToWx;
  const defaultDatabaseId = "mock-db-001";

  beforeAll(async () => {
    // 1. 启动 Mock Hub Server
    mockHubHandle = await startMockHub();

    // 2. 初始化内存数据库和存储
    store = new Store(":memory:");

    // 3. 注入 installation 记录（模拟已完成 OAuth 安装）
    store.saveInstallation({
      id: MOCK_INSTALLATION_ID,
      hubUrl: MOCK_HUB_URL,
      appId: "test-app",
      botId: MOCK_BOT_ID,
      appToken: MOCK_APP_TOKEN,
      webhookSecret: MOCK_WEBHOOK_SECRET,
      createdAt: new Date().toISOString(),
    });

    // 4. 创建 Mock NotionClient 和桥接模块
    const mockNotion = createMockNotionClient();
    wxToNotion = new WxToNotion(mockNotion as any, store, defaultDatabaseId);
    notionToWx = new NotionToWx(store);

    // 5. 启动轻量 App HTTP 服务器（只处理 /hub/webhook）
    appServer = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${APP_PORT}`);

      if (url.pathname === "/hub/webhook") {
        await handleWebhook(req, res, {
          store,
          onEvent: async (event: RawHubEvent) => {
            if (!event.event) return;

            // 仅处理 message 类型事件
            if (event.event.type !== "message") return;

            const installation = store.getInstallation(event.installation_id);
            if (!installation) return;

            const data = event.event.data;
            // 将 Hub 原始事件转换为 WxToNotion 接受的简化格式
            const wxEvent = {
              type: "message" as const,
              fromId: (data.user_id as string) ?? "unknown",
              fromName: (data.user_name as string) ?? "unknown",
              content: (data.text as string) ?? "",
              timestamp: Date.now(),
            };

            await wxToNotion.handleWxEvent(wxEvent, installation);
          },
        });
        return;
      }

      // 健康检查
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve, reject) => {
      appServer.on("error", reject);
      appServer.listen(APP_PORT, () => {
        console.log(`[test] App Server 已启动，端口 ${APP_PORT}`);
        resolve();
      });
    });
  });

  afterAll(async () => {
    // 关闭 App 服务器
    await new Promise<void>((resolve) =>
      appServer.close(() => {
        console.log("[test] App Server 已关闭");
        resolve();
      }),
    );

    // 关闭 Mock Hub Server
    await mockHubHandle.close();

    // 关闭数据库
    store.close();
  });

  beforeEach(() => {
    // 每个测试前重置消息记录
    resetMock();
    notionCreatedPages = [];
    notionAppendedBlocks = [];
    // 注意：不重置 notionPageIdCounter，保证 pageId 在跨测试中唯一
  });

  // ─── 微信->Notion 方向测试 ───

  it("Mock Hub Server 健康检查", async () => {
    const res = await fetch(`${MOCK_HUB_URL}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ status: "ok" });
  });

  it("App Server 健康检查", async () => {
    const res = await fetch(`http://localhost:${APP_PORT}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ status: "ok" });
  });

  it("微信文本消息应通过 Hub->App->Notion 链路创建页面", async () => {
    // Mock Hub 注入微信消息 -> 转发到 App webhook -> WxToNotion 创建 Notion 页面
    await injectMessage("user_alice", "你好 Notion");

    // 等待 WxToNotion 处理完成（Notion 端创建了页面）
    await waitFor(async () => notionCreatedPages.length > 0, 5000);

    // 验证 Notion 端创建了页面
    expect(notionCreatedPages.length).toBe(1);
    expect(notionCreatedPages[0].title).toContain("user_alice");
    expect(notionCreatedPages[0].content).toContain("你好 Notion");
  });

  it("不同微信用户应各自创建独立的 Notion 页面", async () => {
    await injectMessage("user_alpha", "第一条消息");
    await waitFor(async () => notionCreatedPages.length >= 1, 5000);

    await injectMessage("user_beta", "第二条消息");
    await waitFor(async () => notionCreatedPages.length >= 2, 5000);

    // 两个不同用户，应各创建一个新页面
    expect(notionCreatedPages.length).toBe(2);
    expect(notionCreatedPages[0].title).toContain("user_alpha");
    expect(notionCreatedPages[1].title).toContain("user_beta");
  });

  it("同一微信用户的后续消息应追加到已有 Notion 页面", async () => {
    // 第一条消息创建新页面
    await injectMessage("user_charlie", "第一条");
    await waitFor(async () => notionCreatedPages.length > 0, 5000);

    const firstPageId = notionCreatedPages[0].pageId;

    // 第二条消息应追加到同一页面（走 appendBlocks 而非 createPage）
    await injectMessage("user_charlie", "第二条");
    await waitFor(async () => notionAppendedBlocks.length > 0, 5000);

    // 验证追加到了之前创建的页面
    expect(notionAppendedBlocks.length).toBe(1);
    expect(notionAppendedBlocks[0].blockId).toBe(firstPageId);
    // 不应创建新页面
    expect(notionCreatedPages.length).toBe(1);
  });

  it("消息映射应正确保存到 Store", async () => {
    await injectMessage("user_dave", "测试映射");
    await waitFor(async () => notionCreatedPages.length > 0, 5000);

    // 验证 Store 中保存了消息映射
    const link = store.getLatestLinkByWxUser("user_dave");
    expect(link).toBeDefined();
    expect(link!.wxUserId).toBe("user_dave");
    expect(link!.wxUserName).toBe("user_dave");
    expect(link!.installationId).toBe(MOCK_INSTALLATION_ID);
    // notionPageId 应该是 Mock NotionClient 生成的
    expect(link!.notionPageId).toMatch(/^notion_page_/);
  });

  // ─── Notion->微信 方向测试 ───

  it("Notion 页面变更应通过 NotionToWx 通知到微信", async () => {
    // 先模拟一条微信->Notion 的消息，建立消息映射
    await injectMessage("user_eve", "你好，请关注我的页面");
    await waitFor(async () => notionCreatedPages.length > 0, 5000);

    // 获取映射中的 Notion 页面 ID
    const link = store.getLatestLinkByWxUser("user_eve");
    expect(link).toBeDefined();

    // 模拟 Notion 页面发生变更
    const changeEvent: NotionChangeEvent = {
      pageId: link!.notionPageId,
      title: "[微信] user_eve",
      lastEditedTime: new Date().toISOString(),
      url: `https://notion.so/${link!.notionPageId}`,
    };

    const installations = store.getAllInstallations();
    await notionToWx.handleNotionChange(changeEvent, installations);

    // 等待消息发送到 Mock Hub
    await waitFor(async () => {
      const msgs = await getMessages();
      return msgs.length > 0;
    }, 5000);

    // 验证 Mock Hub 收到了变更通知
    const hubMessages = await getMessages();
    expect(hubMessages.length).toBe(1);
    expect(hubMessages[0].toUserId).toBe("user_eve");
    expect(hubMessages[0].content).toContain("Notion");
    expect(hubMessages[0].content).toContain("user_eve");
  });

  it("无关联的 Notion 页面变更应被忽略", async () => {
    // 模拟一个没有关联记录的页面变更
    const changeEvent: NotionChangeEvent = {
      pageId: "unknown_page_id",
      title: "无关页面",
      lastEditedTime: new Date().toISOString(),
      url: "https://notion.so/unknown",
    };

    const installations = store.getAllInstallations();
    await notionToWx.handleNotionChange(changeEvent, installations);

    // Mock Hub 不应收到任何消息
    const hubMessages = await getMessages();
    expect(hubMessages.length).toBe(0);
  });

  // ─── Webhook 验证测试 ───

  it("无效签名的 webhook 请求应被拒绝（401）", async () => {
    const hubEvent = {
      v: "1",
      type: "event",
      trace_id: "tr_bad_sig",
      installation_id: MOCK_INSTALLATION_ID,
      bot: { id: MOCK_BOT_ID },
      event: {
        type: "message",
        id: "evt_bad",
        timestamp: new Date().toISOString(),
        data: {
          user_id: "hacker",
          user_name: "hacker",
          type: "text",
          text: "恶意消息",
        },
      },
    };

    const res = await fetch(`http://localhost:${APP_PORT}/hub/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature": "invalid_signature_here",
      },
      body: JSON.stringify(hubEvent),
    });

    // 应返回 401
    expect(res.status).toBe(401);

    // Notion 端不应创建任何页面
    expect(notionCreatedPages.length).toBe(0);
  });

  it("未知 installation_id 的请求应被拒绝（404）", async () => {
    const hubEvent = {
      v: "1",
      type: "event",
      trace_id: "tr_unknown_inst",
      installation_id: "nonexistent-installation",
      bot: { id: MOCK_BOT_ID },
      event: {
        type: "message",
        id: "evt_unknown",
        timestamp: new Date().toISOString(),
        data: { user_id: "user", text: "test" },
      },
    };

    const res = await fetch(`http://localhost:${APP_PORT}/hub/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature": "whatever",
      },
      body: JSON.stringify(hubEvent),
    });

    // 未知 installation 应返回 404
    expect(res.status).toBe(404);
  });

  it("challenge 握手请求应正确返回 challenge", async () => {
    const challengeEvent = {
      v: "1",
      type: "challenge",
      challenge: "test_challenge_token_123",
      trace_id: "tr_challenge",
      installation_id: MOCK_INSTALLATION_ID,
      bot: { id: MOCK_BOT_ID },
    };

    const bodyStr = JSON.stringify(challengeEvent);
    const crypto = await import("node:crypto");
    const sig = crypto
      .createHmac("sha256", MOCK_WEBHOOK_SECRET)
      .update(bodyStr)
      .digest("hex");

    const res = await fetch(`http://localhost:${APP_PORT}/hub/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature": sig,
      },
      body: bodyStr,
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ challenge: "test_challenge_token_123" });
  });

  it("非 POST 请求应被拒绝（405）", async () => {
    const res = await fetch(`http://localhost:${APP_PORT}/hub/webhook`, {
      method: "GET",
    });
    expect(res.status).toBe(405);
  });

  // ─── 完整双向链路测试 ───

  it("完整双向链路：微信->Notion->微信", async () => {
    // 步骤 1: 微信用户发消息 -> Hub -> App -> Notion 创建页面
    await injectMessage("user_frank", "你好，请帮我记录一下");

    await waitFor(async () => notionCreatedPages.length > 0, 5000);

    // 验证 Notion 端创建了页面
    const latestPage = notionCreatedPages[notionCreatedPages.length - 1];
    expect(latestPage.title).toContain("user_frank");
    expect(latestPage.content).toContain("你好，请帮我记录一下");

    // 步骤 2: 模拟 Notion 页面变更 -> App -> Hub -> 微信
    const link = store.getLatestLinkByWxUser("user_frank");
    expect(link).toBeDefined();

    const changeEvent: NotionChangeEvent = {
      pageId: link!.notionPageId,
      title: "[微信] user_frank",
      lastEditedTime: new Date().toISOString(),
      url: `https://notion.so/${link!.notionPageId}`,
    };

    const installations = store.getAllInstallations();
    await notionToWx.handleNotionChange(changeEvent, installations);

    // 验证 Mock Hub 收到了通知
    await waitFor(async () => {
      const msgs = await getMessages();
      return msgs.length > 0;
    }, 5000);

    const hubMessages = await getMessages();
    expect(hubMessages.length).toBe(1);
    expect(hubMessages[0].toUserId).toBe("user_frank");
    expect(hubMessages[0].content).toContain("user_frank");
  });
});
