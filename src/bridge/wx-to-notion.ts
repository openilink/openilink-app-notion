import type { NotionClient } from '../notion/client.js';

// ─── 类型定义 ─────────────────────────────────────────────

/** Hub 安装实例 */
export interface Installation {
  id: string;
  hubUrl: string;
  appId: string;
  botId: string;
  appToken: string;
  webhookSecret: string;
}

/** 消息关联记录，微信消息与 Notion 页面/块的映射 */
export interface MessageLink {
  installationId: string;
  notionPageId: string;
  notionBlockId: string;
  wxUserId: string;
  wxUserName: string;
}

/** Hub 事件（微信消息事件） */
export interface HubEvent {
  /** 事件类型：message / command / ... */
  type: string;
  /** 来源用户 ID */
  fromId: string;
  /** 来源用户名 */
  fromName: string;
  /** 消息文本内容 */
  content: string;
  /** 事件时间戳（毫秒） */
  timestamp: number;
  /** 原始事件数据 */
  raw?: any;
}

/** 数据存储接口 */
export interface Store {
  saveMessageLink(link: MessageLink): void | Promise<void>;
  getMessageLinkByNotionPage(notionPageId: string, installationId: string): MessageLink | null | undefined | Promise<MessageLink | null | undefined>;
  getLatestLinkByWxUser(wxUserId: string, installationId: string): MessageLink | null | undefined | Promise<MessageLink | null | undefined>;
  getAllInstallations(): Installation[] | Promise<Installation[]>;
}

// ─── 微信 → Notion 桥接 ──────────────────────────────────

/**
 * 微信消息转发到 Notion
 *
 * 策略：
 * - 同一微信用户的消息追加到同一 Notion 页面（通过 MessageLink 查找）
 * - 新用户则创建新页面，标题格式为 "[微信] {fromName}"
 * - 消息以段落块追加到页面，格式为 "[时间] 消息内容"
 * - command 类型事件跳过不处理
 */
export class WxToNotion {
  private notionClient: NotionClient;
  private store: Store;
  private defaultDatabaseId: string;

  constructor(notionClient: NotionClient, store: Store, defaultDatabaseId?: string) {
    this.notionClient = notionClient;
    this.store = store;
    this.defaultDatabaseId = defaultDatabaseId ?? '';
  }

  /**
   * 处理微信事件，将消息转发到 Notion
   * @param event Hub 事件
   * @param installation 安装实例
   */
  async handleWxEvent(event: HubEvent, installation: Installation): Promise<void> {
    // 跳过 command 类型事件
    if (event.type === 'command') {
      console.log('[WxToNotion] 跳过 command 事件');
      return;
    }

    // 只处理 message 类型
    if (event.type !== 'message') {
      console.log(`[WxToNotion] 忽略非消息事件: ${event.type}`);
      return;
    }

    try {
      // 格式化时间戳
      const timeStr = new Date(event.timestamp).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
      });
      const blockContent = `[${timeStr}] ${event.content}`;

      // 查找该微信用户在当前安装实例下已有的消息关联
      const existingLink = await this.store.getLatestLinkByWxUser(event.fromId, installation.id);

      if (existingLink) {
        // 已有页面，追加内容
        await this.notionClient.appendBlocks(existingLink.notionPageId, [
          NotionClientHelper.textBlock(blockContent),
        ]);
        console.log(
          `[WxToNotion] 消息已追加到页面 ${existingLink.notionPageId}（用户: ${event.fromName}）`,
        );
      } else {
        // 新用户，创建新页面
        const dbId = this.defaultDatabaseId || undefined;
        const result = await this.notionClient.createPage(
          dbId ?? '',
          `[微信] ${event.fromName}`,
          undefined,
          blockContent,
        );

        // 保存消息关联
        const link: MessageLink = {
          installationId: installation.id,
          notionPageId: result.pageId,
          notionBlockId: '', // 创建时暂无具体块 ID
          wxUserId: event.fromId,
          wxUserName: event.fromName,
        };
        await this.store.saveMessageLink(link);

        console.log(
          `[WxToNotion] 已为用户 ${event.fromName} 创建新页面 ${result.pageId}`,
        );
      }
    } catch (error) {
      console.error(`[WxToNotion] 处理微信消息失败（用户: ${event.fromName}）:`, error);
      throw error;
    }
  }
}

/**
 * NotionClient 静态方法的本地引用
 * 避免循环依赖，将 textBlock 辅助方法内联
 */
const NotionClientHelper = {
  textBlock(content: string): any {
    return {
      type: 'paragraph',
      paragraph: {
        rich_text: [{ text: { content } }],
      },
    };
  },
};
