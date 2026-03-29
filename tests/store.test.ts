/**
 * Store 持久化层测试
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "../src/store.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Store", () => {
  let store: Store;
  let dbPath: string;

  beforeEach(() => {
    // 在临时目录中创建测试数据库
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-store-test-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new Store(dbPath);
  });

  afterEach(() => {
    store.close();
    // 清理临时文件
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ─── Installation 测试 ──────────────────────────────

  describe("saveInstallation / getInstallation", () => {
    it("保存并读取安装记录", () => {
      const inst = {
        id: "inst-001",
        hubUrl: "https://hub.example.com",
        appId: "app-001",
        botId: "bot-001",
        appToken: "token-001",
        webhookSecret: "secret-001",
        createdAt: "2025-01-01T00:00:00.000Z",
      };

      store.saveInstallation(inst);
      const result = store.getInstallation("inst-001");

      expect(result).toBeDefined();
      expect(result!.id).toBe("inst-001");
      expect(result!.hubUrl).toBe("https://hub.example.com");
      expect(result!.appId).toBe("app-001");
      expect(result!.botId).toBe("bot-001");
      expect(result!.appToken).toBe("token-001");
      expect(result!.webhookSecret).toBe("secret-001");
    });

    it("查询不存在的安装记录返回 undefined", () => {
      const result = store.getInstallation("nonexistent");
      expect(result).toBeUndefined();
    });

    it("更新已有的安装记录", () => {
      const inst = {
        id: "inst-001",
        hubUrl: "https://hub.example.com",
        appId: "app-001",
        botId: "bot-001",
        appToken: "old-token",
        webhookSecret: "old-secret",
      };

      store.saveInstallation(inst);

      // 更新 token
      store.saveInstallation({
        ...inst,
        appToken: "new-token",
        webhookSecret: "new-secret",
      });

      const result = store.getInstallation("inst-001");
      expect(result!.appToken).toBe("new-token");
      expect(result!.webhookSecret).toBe("new-secret");
    });
  });

  describe("getAllInstallations", () => {
    it("返回所有安装记录", () => {
      store.saveInstallation({
        id: "inst-001",
        hubUrl: "https://hub.example.com",
        appId: "app-001",
        botId: "bot-001",
        appToken: "token-001",
        webhookSecret: "secret-001",
      });
      store.saveInstallation({
        id: "inst-002",
        hubUrl: "https://hub.example.com",
        appId: "app-002",
        botId: "bot-002",
        appToken: "token-002",
        webhookSecret: "secret-002",
      });

      const all = store.getAllInstallations();
      expect(all).toHaveLength(2);
    });

    it("空数据库返回空数组", () => {
      const all = store.getAllInstallations();
      expect(all).toEqual([]);
    });
  });

  // ─── MessageLink 测试 ───────────────────────────────

  describe("saveMessageLink / getMessageLinkByNotionPage", () => {
    it("保存消息关联并通过 notionPageId 查询", () => {
      // 先创建安装记录（外键依赖）
      store.saveInstallation({
        id: "inst-001",
        hubUrl: "https://hub.example.com",
        appId: "app-001",
        botId: "bot-001",
        appToken: "token-001",
        webhookSecret: "secret-001",
      });

      const link = {
        installationId: "inst-001",
        notionPageId: "page-abc",
        notionBlockId: "block-xyz",
        wxUserId: "wx-user-001",
        wxUserName: "张三",
        createdAt: "2025-01-01T00:00:00.000Z",
      };

      store.saveMessageLink(link);

      const result = store.getMessageLinkByNotionPage("page-abc");
      expect(result).toBeDefined();
      expect(result!.notionPageId).toBe("page-abc");
      expect(result!.notionBlockId).toBe("block-xyz");
      expect(result!.wxUserId).toBe("wx-user-001");
      expect(result!.wxUserName).toBe("张三");
    });

    it("查询不存在的 notionPageId 返回 undefined", () => {
      const result = store.getMessageLinkByNotionPage("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("getLatestLinkByWxUser", () => {
    it("根据微信用户 ID 获取最新关联记录", () => {
      // 先创建安装记录（满足 FK 约束）
      store.saveInstallation({
        id: "inst-001",
        hubUrl: "https://hub.test",
        appId: "app-001",
        botId: "bot-001",
        appToken: "token-001",
        webhookSecret: "secret-001",
      });

      store.saveMessageLink({
        installationId: "inst-001",
        notionPageId: "page-001",
        notionBlockId: "block-001",
        wxUserId: "wx-user-001",
        wxUserName: "张三",
        createdAt: "2025-01-01T00:00:00.000Z",
      });
      store.saveMessageLink({
        installationId: "inst-001",
        notionPageId: "page-002",
        notionBlockId: "block-002",
        wxUserId: "wx-user-001",
        wxUserName: "张三",
        createdAt: "2025-01-02T00:00:00.000Z",
      });

      const result = store.getLatestLinkByWxUser("wx-user-001");
      expect(result).toBeDefined();
      // 应返回最新的记录（按 created_at 降序）
      expect(result!.notionPageId).toBe("page-002");
    });

    it("查询不存在的微信用户返回 undefined", () => {
      const result = store.getLatestLinkByWxUser("nonexistent");
      expect(result).toBeUndefined();
    });
  });
});
