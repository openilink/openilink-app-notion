/**
 * 搜索工具模块
 */
import type { ToolModule, ToolDefinition, ToolHandler } from '../hub/types.js';
import type { NotionClient } from '../notion/client.js';

/** 工具定义 */
const definitions: ToolDefinition[] = [
  {
    name: 'search_notion',
    description: '搜索 Notion 中的页面或数据库',
    command: 'search_notion',
    parameters: {
      query: { type: 'string', description: '搜索关键词', required: true },
      type: { type: 'string', description: '搜索类型：page 或 database', enum: ['page', 'database'] },
      count: { type: 'number', description: '返回数量，默认 10' },
    },
  },
];

/** 提取 Notion 对象的标题 */
function extractTitle(item: any): string {
  // 页面标题
  if (item.properties?.title?.title) {
    return item.properties.title.title.map((t: any) => t.plain_text).join('') || '无标题';
  }
  // 页面中的 Name 属性
  if (item.properties?.Name?.title) {
    return item.properties.Name.title.map((t: any) => t.plain_text).join('') || '无标题';
  }
  // 数据库标题
  if (item.title) {
    return item.title.map((t: any) => t.plain_text).join('') || '无标题';
  }
  // 遍历所有属性查找 title 类型
  if (item.properties) {
    for (const prop of Object.values(item.properties) as any[]) {
      if (prop.type === 'title' && prop.title) {
        return prop.title.map((t: any) => t.plain_text).join('') || '无标题';
      }
    }
  }
  return '无标题';
}

/** 创建处理函数 */
function createHandlers(client: NotionClient): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set('search_notion', async (ctx) => {
    try {
      const { query, type, count } = ctx.args as Record<string, any>;
      if (!query) return '错误：请提供搜索关键词（query）';

      const pageSize = (count as number) ?? 10;
      const results = await client.search(query as string, type as 'page' | 'database' | undefined, pageSize);

      if (results.length === 0) {
        return `未找到与「${query}」相关的结果`;
      }

      const lines = results.map((item: any, i: number) => {
        const title = extractTitle(item);
        const url = item.url || '无链接';
        const lastEdited = item.last_edited_time
          ? new Date(item.last_edited_time).toLocaleString('zh-CN')
          : '未知';
        const objType = item.object === 'page' ? '页面' : '数据库';
        return `${i + 1}. [${objType}] ${title}\n   链接：${url}\n   最后编辑：${lastEdited}`;
      });

      return `搜索「${query}」找到 ${results.length} 条结果：\n\n${lines.join('\n\n')}`;
    } catch (err: any) {
      return `搜索失败：${err.message}`;
    }
  });

  return handlers;
}

export const searchTools: ToolModule = { definitions, createHandlers };
