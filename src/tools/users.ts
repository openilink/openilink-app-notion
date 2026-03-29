/**
 * 用户工具模块
 */
import type { ToolModule, ToolDefinition, ToolHandler } from '../hub/types.js';
import type { NotionClient } from '../notion/client.js';

/** 工具定义 */
const definitions: ToolDefinition[] = [
  {
    name: 'list_users',
    description: '列出 Notion 工作区中的所有用户',
    command: 'list_users',
  },
  {
    name: 'get_me',
    description: '获取当前 Notion 集成（机器人）的信息',
    command: 'get_me',
  },
];

/** 创建处理函数 */
function createHandlers(client: NotionClient): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 列出用户
  handlers.set('list_users', async (_ctx) => {
    try {
      const users = await client.listUsers();

      if (users.length === 0) {
        return '工作区中没有找到用户';
      }

      const lines = users.map((user: any, i: number) => {
        const name = user.name || '未命名';
        const type = user.type === 'person' ? '成员' : '机器人';
        const email = user.person?.email || '';
        const emailPart = email ? `（${email}）` : '';
        return `${i + 1}. [${type}] ${name}${emailPart}`;
      });

      return `工作区共 ${users.length} 位用户：\n\n${lines.join('\n')}`;
    } catch (err: any) {
      return `获取用户列表失败：${err.message}`;
    }
  });

  // 获取当前集成信息
  handlers.set('get_me', async (_ctx) => {
    try {
      const me = await client.getMe();

      const name = me.name || '未命名';
      const type = me.type === 'bot' ? '机器人' : '用户';
      const id = me.id || '未知';
      const botOwner = me.bot?.owner?.type || '未知';

      return [
        `当前集成信息：`,
        `  名称：${name}`,
        `  类型：${type}`,
        `  ID：${id}`,
        `  所有者类型：${botOwner}`,
      ].join('\n');
    } catch (err: any) {
      return `获取集成信息失败：${err.message}`;
    }
  });

  return handlers;
}

export const userTools: ToolModule = { definitions, createHandlers };
