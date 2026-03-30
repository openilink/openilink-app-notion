import type { NotionChangeEvent } from '../notion/event.js';
import type { Installation, MessageLink, Store } from './wx-to-notion.js';

/**
 * Notion 变更通知到微信
 *
 * 当 Notion 页面发生变更时，查找对应的微信用户并发送通知。
 * 通过 MessageLink 关联关系找到页面对应的微信用户，
 * 然后通过 Hub API 向该用户推送变更通知。
 */
export class NotionToWx {
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  /**
   * 处理 Notion 页面变更事件
   *
   * 当检测到页面变更时：
   * 1. 通过 MessageLink 查找该页面关联的微信用户
   * 2. 如果找到关联用户，通过对应的 Installation 发送通知
   *
   * @param event Notion 变更事件
   * @param installations 所有安装实例列表
   */
  async handleNotionChange(
    event: NotionChangeEvent,
    installations: Installation[],
  ): Promise<void> {
    try {
      // 遍历所有安装实例，查找该页面对应的消息关联
      let link: MessageLink | null | undefined;
      let installation: Installation | undefined;
      for (const inst of installations) {
        const found = await this.store.getMessageLinkByNotionPage(event.pageId, inst.id);
        if (found) {
          link = found;
          installation = inst;
          break;
        }
      }

      if (!link) {
        // 没有关联的微信用户，跳过
        console.log(
          `[NotionToWx] 页面 ${event.pageId} 没有关联的微信用户，跳过通知`,
        );
        return;
      }
      if (!installation) {
        console.warn(
          `[NotionToWx] 找不到安装实例 ${link.installationId}，无法发送通知`,
        );
        return;
      }

      // 构建通知消息
      const message = this.buildNotificationMessage(event);

      // 通过 Hub API 发送消息到微信用户
      await this.sendToWxUser(installation, link.wxUserId, message);

      console.log(
        `[NotionToWx] 已向微信用户 ${link.wxUserName}(${link.wxUserId}) 发送 Notion 变更通知`,
      );
    } catch (error) {
      console.error(
        `[NotionToWx] 处理 Notion 变更通知失败（页面: ${event.pageId}）:`,
        error,
      );
      throw error;
    }
  }

  /**
   * 构建 Notion 变更通知消息文本
   * @param event Notion 变更事件
   * @returns 格式化的通知消息
   */
  private buildNotificationMessage(event: NotionChangeEvent): string {
    const time = new Date(event.lastEditedTime).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
    });
    return (
      `📝 Notion 页面更新通知\n` +
      `标题: ${event.title}\n` +
      `时间: ${time}\n` +
      `链接: ${event.url}`
    );
  }

  /**
   * 通过 Hub API 向微信用户发送消息
   *
   * @param installation 安装实例（包含 hubUrl 和认证信息）
   * @param wxUserId 目标微信用户 ID
   * @param message 消息内容
   */
  private async sendToWxUser(
    installation: Installation,
    wxUserId: string,
    message: string,
  ): Promise<void> {
    try {
      const url = `${installation.hubUrl}/api/v1/send`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${installation.appToken}`,
        },
        body: JSON.stringify({
          botId: installation.botId,
          toUserId: wxUserId,
          content: message,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Hub API 响应异常: ${response.status} ${response.statusText} - ${body}`,
        );
      }
    } catch (error) {
      console.error(
        `[NotionToWx] 发送消息到微信用户 ${wxUserId} 失败:`,
        error,
      );
      throw error;
    }
  }
}
