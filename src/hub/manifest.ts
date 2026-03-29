/**
 * 应用清单定义
 *
 * 向 Hub 注册时使用的元信息，包含应用名称、图标、订阅的事件类型等。
 */

/** 应用清单结构 */
export interface AppManifest {
  /** 应用唯一标识（URL 友好） */
  slug: string;
  /** 应用显示名称 */
  name: string;
  /** 应用图标（emoji 或 URL） */
  icon: string;
  /** 应用描述 */
  description: string;
  /** 订阅的事件类型列表 */
  events: string[];
}

/** Notion Bridge 应用清单 */
export const manifest: AppManifest = {
  slug: "notion-bridge",
  name: "Notion",
  icon: "\uD83D\uDCDD",
  description: "微信 ↔ Notion 双向桥接，支持消息同步与 Notion AI Tools",
  events: ["message", "command"],
};
