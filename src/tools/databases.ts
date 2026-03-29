/**
 * 数据库工具模块
 */
import type { ToolModule, ToolDefinition, ToolHandler } from '../hub/types.js';
import type { NotionClient } from '../notion/client.js';

/** 工具定义 */
const definitions: ToolDefinition[] = [
  {
    name: 'query_database',
    description: '查询 Notion 数据库中的条目',
    command: 'query_database',
    parameters: {
      database_id: { type: 'string', description: '数据库 ID', required: true },
      filter: { type: 'string', description: '过滤条件，JSON 格式' },
      sort_by: { type: 'string', description: '排序属性名' },
      sort_direction: { type: 'string', description: '排序方向', enum: ['ascending', 'descending'] },
      count: { type: 'number', description: '返回数量' },
    },
  },
  {
    name: 'get_database_schema',
    description: '获取 Notion 数据库的结构信息（属性名和类型）',
    command: 'get_database_schema',
    parameters: {
      database_id: { type: 'string', description: '数据库 ID', required: true },
    },
  },
  {
    name: 'create_database_item',
    description: '在 Notion 数据库中创建新条目',
    command: 'create_database_item',
    parameters: {
      database_id: { type: 'string', description: '数据库 ID', required: true },
      title: { type: 'string', description: '条目标题', required: true },
      properties: { type: 'string', description: '额外属性，JSON 格式' },
    },
  },
];

/** 提取条目标题 */
function extractItemTitle(item: any): string {
  if (item.properties) {
    for (const prop of Object.values(item.properties) as any[]) {
      if (prop.type === 'title' && prop.title) {
        return prop.title.map((t: any) => t.plain_text).join('') || '无标题';
      }
    }
  }
  return '无标题';
}

/** 格式化数据库条目概要 */
function formatItemSummary(item: any, index: number): string {
  const title = extractItemTitle(item);
  const url = item.url || '无链接';
  const lastEdited = item.last_edited_time
    ? new Date(item.last_edited_time).toLocaleString('zh-CN')
    : '未知';
  return `${index + 1}. ${title}\n   链接：${url}\n   最后编辑：${lastEdited}`;
}

/** 创建处理函数 */
function createHandlers(client: NotionClient): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 查询数据库
  handlers.set('query_database', async (ctx) => {
    try {
      const { database_id, filter, sort_by, sort_direction, count } = ctx.args as Record<string, any>;
      if (!database_id) return '错误：请提供数据库 ID（database_id）';

      // 解析过滤条件
      let parsedFilter: any;
      if (filter) {
        try {
          parsedFilter = typeof filter === 'string' ? JSON.parse(filter) : filter;
        } catch {
          return '错误：filter 不是合法的 JSON 格式';
        }
      }

      // 构建排序条件
      let sorts: any[] | undefined;
      if (sort_by) {
        sorts = [
          {
            property: sort_by,
            direction: sort_direction || 'descending',
          },
        ];
      }

      const results = await client.queryDatabase(database_id as string, parsedFilter, sorts, count as number | undefined);

      if (results.length === 0) {
        return '查询结果为空，没有找到匹配的条目';
      }

      const lines = results.map((item: any, i: number) => formatItemSummary(item, i));
      return `查询到 ${results.length} 条结果：\n\n${lines.join('\n\n')}`;
    } catch (err: any) {
      return `查询数据库失败：${err.message}`;
    }
  });

  // 获取数据库结构
  handlers.set('get_database_schema', async (ctx) => {
    try {
      const { database_id } = ctx.args as Record<string, any>;
      if (!database_id) return '错误：请提供数据库 ID（database_id）';

      const db = await client.getDatabase(database_id as string);

      // 提取数据库标题
      const dbTitle = db.title?.map((t: any) => t.plain_text).join('') || '无标题';

      // 解析属性结构
      const properties = db.properties || {};
      const propLines = Object.entries(properties).map(([name, prop]: [string, any]) => {
        let detail = `  ${name}：${prop.type}`;
        // 对 select/multi_select 列出选项
        if (prop.type === 'select' && prop.select?.options) {
          const options = prop.select.options.map((o: any) => o.name).join(', ');
          detail += `（选项：${options}）`;
        }
        if (prop.type === 'multi_select' && prop.multi_select?.options) {
          const options = prop.multi_select.options.map((o: any) => o.name).join(', ');
          detail += `（选项：${options}）`;
        }
        if (prop.type === 'status' && prop.status?.options) {
          const options = prop.status.options.map((o: any) => o.name).join(', ');
          detail += `（选项：${options}）`;
        }
        return detail;
      });

      return [
        `数据库：${dbTitle}`,
        `ID：${database_id}`,
        `\n属性列表（共 ${propLines.length} 个）：`,
        ...propLines,
      ].join('\n');
    } catch (err: any) {
      return `获取数据库结构失败：${err.message}`;
    }
  });

  // 创建数据库条目
  handlers.set('create_database_item', async (ctx) => {
    try {
      const { database_id, title, properties } = ctx.args as Record<string, any>;
      if (!database_id) return '错误：请提供数据库 ID（database_id）';
      if (!title) return '错误：请提供条目标题（title）';

      // 解析额外属性
      let extraProps: Record<string, any> | undefined;
      if (properties) {
        try {
          extraProps = typeof properties === 'string' ? JSON.parse(properties) : properties;
        } catch {
          return '错误：properties 不是合法的 JSON 格式';
        }
      }

      const result = await client.createPage(database_id as string, title as string, extraProps);
      return `条目创建成功！\n标题：${title}\n页面 ID：${result.pageId}\n链接：${result.url}`;
    } catch (err: any) {
      return `创建数据库条目失败：${err.message}`;
    }
  });

  return handlers;
}

export const databaseTools: ToolModule = { definitions, createHandlers };
