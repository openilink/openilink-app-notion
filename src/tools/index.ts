/**
 * 工具注册中心 — 汇总所有 Notion 工具模块
 */
import type { ToolDefinition, ToolHandler } from '../hub/types.js';
import type { NotionClient } from '../notion/client.js';

import { searchTools } from './search.js';
import { pageTools } from './pages.js';
import { databaseTools } from './databases.js';
import { blockTools } from './blocks.js';
import { commentTools } from './comments.js';
import { userTools } from './users.js';

/** 所有工具模块 */
const allModules = [
  searchTools,
  pageTools,
  databaseTools,
  blockTools,
  commentTools,
  userTools,
];

/**
 * 收集所有工具定义和处理函数
 * @param client NotionClient 实例
 * @returns 工具定义列表和处理函数映射
 */
export function collectAllTools(client: NotionClient): {
  definitions: ToolDefinition[];
  handlers: Map<string, ToolHandler>;
} {
  const definitions: ToolDefinition[] = [];
  const handlers = new Map<string, ToolHandler>();

  for (const mod of allModules) {
    // 收集定义
    definitions.push(...mod.definitions);

    // 收集处理函数
    const moduleHandlers = mod.createHandlers(client);
    for (const [name, handler] of moduleHandlers) {
      handlers.set(name, handler);
    }
  }

  return { definitions, handlers };
}
