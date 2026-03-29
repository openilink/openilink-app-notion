/**
 * Hub Bot API 客户端
 *
 * 封装与 Hub 的 HTTP 通信，提供发送消息、上报工具定义等能力。
 * Bot API 路径前缀: /bot/v1
 */

import type { ToolDefinition } from "./types.js";

/** 发送消息请求参数 */
export interface SendMessageParams {
  /** 目标用户 ID */
  userId: string;
  /** 消息内容（文本） */
  text: string;
  /** 链路追踪 ID */
  traceId?: string;
}

/**
 * Hub Bot API 客户端
 * 通过 appToken 认证，向 Hub 发送消息和注册工具
 */
export class HubClient {
  private hubUrl: string;
  private appToken: string;

  constructor(hubUrl: string, appToken: string) {
    // 移除末尾斜杠
    this.hubUrl = hubUrl.replace(/\/+$/, "");
    this.appToken = appToken;
  }

  /**
   * 发送文本消息给指定用户
   * POST /bot/v1/message/send
   */
  async sendMessage(params: SendMessageParams): Promise<void> {
    const url = `${this.hubUrl}/bot/v1/message/send`;
    const payload: Record<string, string> = {
      to: params.userId,
      type: "text",
      content: params.text,
    };
    if (params.traceId) {
      payload.trace_id = params.traceId;
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.appToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`[hub-client] 发送消息失败: ${resp.status} - ${errText}`);
    }
  }

  /**
   * 同步工具定义到 Hub
   * PUT /bot/v1/app/tools
   */
  async syncTools(tools: ToolDefinition[]): Promise<void> {
    const url = `${this.hubUrl}/bot/v1/app/tools`;
    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.appToken}`,
      },
      body: JSON.stringify({ tools }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[hub-client] syncTools 失败 [${resp.status}]: ${errText}`);
    }
  }
}
