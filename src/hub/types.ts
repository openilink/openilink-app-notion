/**
 * Hub 协议相关类型定义
 */

/** Hub 推送的事件结构 */
export interface HubEvent {
  /** 协议版本 */
  v: string;
  /** 事件类型：event / challenge / install */
  type: string;
  /** 链路追踪 ID */
  trace_id: string;
  /** 握手挑战值（type=challenge 时存在） */
  challenge?: string;
  /** 安装实例 ID */
  installation_id: string;
  /** 关联的 Bot 信息 */
  bot: {
    id: string;
  };
  /** 业务事件载荷（type=event 时存在） */
  event?: {
    /** 事件子类型：message / command 等 */
    type: string;
    /** 事件唯一 ID */
    id: string;
    /** 事件发生时间戳 */
    timestamp: string;
    /** 事件数据 */
    data: Record<string, unknown>;
  };
}

/** 安装实例记录 */
export interface Installation {
  /** 安装实例 ID */
  id: string;
  /** Hub 服务地址 */
  hubUrl: string;
  /** 应用 ID */
  appId: string;
  /** Bot ID */
  botId: string;
  /** 应用访问令牌 */
  appToken: string;
  /** Webhook 签名密钥 */
  webhookSecret: string;
  /** 创建时间 */
  createdAt?: string;
}

/** 消息关联记录（微信消息 ↔ Notion 页面/块） */
export interface MessageLink {
  /** 记录 ID（自增） */
  id?: number;
  /** 安装实例 ID */
  installationId: string;
  /** Notion 页面 ID */
  notionPageId: string;
  /** Notion 块 ID */
  notionBlockId: string;
  /** 微信用户 ID */
  wxUserId: string;
  /** 微信用户名 */
  wxUserName: string;
  /** 创建时间 */
  createdAt?: string;
}

/** AI Tool 定义 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 触发指令 */
  command: string;
  /** JSON Schema 参数定义 */
  parameters?: Record<string, unknown>;
}

/** AI Tool 执行上下文 */
export interface ToolContext {
  /** 安装实例 ID */
  installationId: string;
  /** Bot ID */
  botId: string;
  /** 触发用户 ID */
  userId: string;
  /** 链路追踪 ID */
  traceId: string;
  /** 工具参数 */
  args: Record<string, any>;
}

/** AI Tool 处理函数类型 */
export type ToolHandler = (ctx: ToolContext) => Promise<string>;

/** 工具模块接口 */
export interface ToolModule {
  /** 工具定义列表 */
  definitions: ToolDefinition[];
  /** 创建工具处理函数映射 */
  createHandlers: (client: NotionClient) => Map<string, ToolHandler>;
}

// 前向声明，避免循环依赖
import type { NotionClient } from "../notion/client.js";
export type { NotionClient };
