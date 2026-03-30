/**
 * SQLite 持久化存储层（基于 better-sqlite3）
 */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { Installation, MessageLink } from "./hub/types.js";
import { encryptConfig, decryptConfig } from "./utils/config-crypto.js";

/** 数据库存储管理器 */
export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    // 确保数据目录存在
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);

    // 启用 WAL 模式以提升并发性能
    this.db.pragma("journal_mode = WAL");

    this.initTables();
  }

  /** 创建所需的数据表 */
  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS installations (
        id            TEXT PRIMARY KEY,
        hub_url       TEXT NOT NULL,
        app_id        TEXT NOT NULL,
        bot_id        TEXT NOT NULL,
        app_token     TEXT NOT NULL,
        webhook_secret TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS message_links (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        installation_id TEXT NOT NULL,
        notion_page_id  TEXT NOT NULL,
        notion_block_id TEXT NOT NULL,
        wx_user_id      TEXT NOT NULL,
        wx_user_name    TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (installation_id) REFERENCES installations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_message_links_notion_page
        ON message_links(notion_page_id);
      CREATE INDEX IF NOT EXISTS idx_message_links_wx_user
        ON message_links(wx_user_id);
    `);

    /** 追加 encrypted_config 列（已有表平滑迁移） */
    try {
      this.db.exec(`ALTER TABLE installations ADD COLUMN encrypted_config TEXT NOT NULL DEFAULT ''`);
    } catch {
      // 列已存在则忽略
    }
  }

  // ─── Installation CRUD ────────────────────────────────────

  /** 保存或更新安装记录 */
  saveInstallation(inst: Installation): void {
    const stmt = this.db.prepare(`
      INSERT INTO installations (id, hub_url, app_id, bot_id, app_token, webhook_secret, created_at)
      VALUES (@id, @hubUrl, @appId, @botId, @appToken, @webhookSecret, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        hub_url        = excluded.hub_url,
        app_id         = excluded.app_id,
        bot_id         = excluded.bot_id,
        app_token      = excluded.app_token,
        webhook_secret = excluded.webhook_secret
    `);
    stmt.run({
      id: inst.id,
      hubUrl: inst.hubUrl,
      appId: inst.appId,
      botId: inst.botId,
      appToken: inst.appToken,
      webhookSecret: inst.webhookSecret,
      createdAt: inst.createdAt || new Date().toISOString(),
    });
  }

  /** 根据 ID 获取单条安装记录 */
  getInstallation(id: string): Installation | undefined {
    const row = this.db
      .prepare("SELECT * FROM installations WHERE id = ?")
      .get(id) as Record<string, string> | undefined;

    if (!row) return undefined;
    return this.rowToInstallation(row);
  }

  /** 获取所有安装记录 */
  getAllInstallations(): Installation[] {
    const rows = this.db
      .prepare("SELECT * FROM installations ORDER BY created_at DESC")
      .all() as Record<string, string>[];

    return rows.map((row) => this.rowToInstallation(row));
  }

  /** 将数据库行映射为 Installation 对象 */
  private rowToInstallation(row: Record<string, string>): Installation {
    return {
      id: row.id,
      hubUrl: row.hub_url,
      appId: row.app_id,
      botId: row.bot_id,
      appToken: row.app_token,
      webhookSecret: row.webhook_secret,
      createdAt: row.created_at,
    };
  }

  // ─── MessageLink CRUD ─────────────────────────────────────

  /** 保存消息关联记录 */
  saveMessageLink(link: MessageLink): void {
    const stmt = this.db.prepare(`
      INSERT INTO message_links (installation_id, notion_page_id, notion_block_id, wx_user_id, wx_user_name, created_at)
      VALUES (@installationId, @notionPageId, @notionBlockId, @wxUserId, @wxUserName, @createdAt)
    `);
    const result = stmt.run({
      installationId: link.installationId,
      notionPageId: link.notionPageId,
      notionBlockId: link.notionBlockId,
      wxUserId: link.wxUserId,
      wxUserName: link.wxUserName,
      createdAt: link.createdAt || new Date().toISOString(),
    });
  }

  /** 根据 Notion 页面 ID 和安装实例 ID 查询关联记录 */
  getMessageLinkByNotionPage(notionPageId: string, installationId: string): MessageLink | undefined {
    const row = this.db
      .prepare("SELECT * FROM message_links WHERE notion_page_id = ? AND installation_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(notionPageId, installationId) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this.rowToMessageLink(row);
  }

  /** 根据微信用户 ID 和安装实例 ID 查询最新一条关联记录 */
  getLatestLinkByWxUser(wxUserId: string, installationId: string): MessageLink | undefined {
    const row = this.db
      .prepare("SELECT * FROM message_links WHERE wx_user_id = ? AND installation_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(wxUserId, installationId) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this.rowToMessageLink(row);
  }

  /** 将数据库行映射为 MessageLink 对象 */
  private rowToMessageLink(row: Record<string, unknown>): MessageLink {
    return {
      id: row.id as number,
      installationId: row.installation_id as string,
      notionPageId: row.notion_page_id as string,
      notionBlockId: row.notion_block_id as string,
      wxUserId: row.wx_user_id as string,
      wxUserName: row.wx_user_name as string,
      createdAt: row.created_at as string,
    };
  }

  /* ======================== encrypted_config CRUD ======================== */

  /**
   * 将配置加密后保存到对应安装记录
   * @param installationId - 安装实例 ID
   * @param plainConfig    - 明文配置对象
   * @param appToken       - 用于派生加密密钥的 app_token
   */
  saveConfig(installationId: string, plainConfig: Record<string, string>, appToken: string): void {
    const cipher = encryptConfig(plainConfig, appToken);
    this.db
      .prepare("UPDATE installations SET encrypted_config = ? WHERE id = ?")
      .run(cipher, installationId);
  }

  /**
   * 读取并解密指定安装的配置
   * @param installationId - 安装实例 ID
   * @param appToken       - 用于派生解密密钥的 app_token
   * @returns 解密后的配置对象，若无配置则返回 undefined
   */
  getConfig(installationId: string, appToken: string): Record<string, string> | undefined {
    const row = this.db
      .prepare("SELECT encrypted_config FROM installations WHERE id = ?")
      .get(installationId) as { encrypted_config: string } | undefined;
    if (!row || !row.encrypted_config) return undefined;
    return decryptConfig(row.encrypted_config, appToken);
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }
}
