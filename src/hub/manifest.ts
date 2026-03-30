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
  /** 所需权限范围 */
  scopes: string[];
  /** 配置表单 JSON Schema */
  config_schema?: Record<string, unknown>;
  /** 安装引导说明（Markdown） */
  guide?: string;
}

/** Notion Bridge 应用清单 */
export const manifest: AppManifest = {
  slug: "notion-bridge",
  name: "Notion",
  icon: "\uD83D\uDCDD",
  description: "微信 ↔ Notion 双向桥接，支持消息同步与 Notion AI Tools",
  events: ["message", "command"],
  scopes: ["tools:write", "config:read"],
  config_schema: {
    type: "object",
    properties: {
      notion_token: { type: "string", title: "Notion Integration Token", description: "以 ntn_ 开头的集成令牌" },
      notion_database_id: { type: "string", title: "Notion 数据库 ID", description: "默认写入的数据库 ID（可选）" },
    },
    required: ["notion_token"],
  },
  guide: "## Notion 安装指南\n### 第 1 步\n访问 [notion.so/profile/integrations](https://www.notion.com/profile/integrations) 创建集成\n### 第 2 步\n复制 Token（ntn_ 开头）\n### 第 3 步\n在 Notion 页面/数据库设置中「连接」到你的集成\n### 第 4 步\n填写上方配置并安装",
};
