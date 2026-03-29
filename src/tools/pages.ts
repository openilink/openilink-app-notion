/**
 * 页面工具模块
 */
import type { ToolModule, ToolDefinition, ToolHandler } from '../hub/types.js';
import type { NotionClient } from '../notion/client.js';

/** 工具定义 */
const definitions: ToolDefinition[] = [
  {
    name: 'create_page',
    description: '在 Notion 数据库中创建新页面',
    command: 'create_page',
    parameters: {
      database_id: { type: 'string', description: '目标数据库 ID', required: true },
      title: { type: 'string', description: '页面标题', required: true },
      content: { type: 'string', description: '页面正文内容（可选）' },
    },
  },
  {
    name: 'get_page',
    description: '获取 Notion 页面详情',
    command: 'get_page',
    parameters: {
      page_id: { type: 'string', description: '页面 ID', required: true },
    },
  },
  {
    name: 'update_page',
    description: '更新 Notion 页面属性',
    command: 'update_page',
    parameters: {
      page_id: { type: 'string', description: '页面 ID', required: true },
      properties: { type: 'string', description: '要更新的属性，JSON 格式字符串', required: true },
    },
  },
  {
    name: 'read_page_content',
    description: '读取 Notion 页面的正文内容',
    command: 'read_page_content',
    parameters: {
      page_id: { type: 'string', description: '页面 ID', required: true },
      count: { type: 'number', description: '读取的块数量，默认 50' },
    },
  },
];

/** 提取页面标题 */
function extractPageTitle(page: any): string {
  if (page.properties) {
    for (const prop of Object.values(page.properties) as any[]) {
      if (prop.type === 'title' && prop.title) {
        return prop.title.map((t: any) => t.plain_text).join('') || '无标题';
      }
    }
  }
  return '无标题';
}

/** 格式化页面属性 */
function formatProperties(properties: Record<string, any>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const type = value.type;
    let display: string;
    switch (type) {
      case 'title':
        display = value.title?.map((t: any) => t.plain_text).join('') || '';
        break;
      case 'rich_text':
        display = value.rich_text?.map((t: any) => t.plain_text).join('') || '';
        break;
      case 'number':
        display = value.number?.toString() ?? '';
        break;
      case 'select':
        display = value.select?.name || '';
        break;
      case 'multi_select':
        display = value.multi_select?.map((s: any) => s.name).join(', ') || '';
        break;
      case 'date':
        display = value.date?.start || '';
        if (value.date?.end) display += ` ~ ${value.date.end}`;
        break;
      case 'checkbox':
        display = value.checkbox ? '是' : '否';
        break;
      case 'url':
        display = value.url || '';
        break;
      case 'email':
        display = value.email || '';
        break;
      case 'phone_number':
        display = value.phone_number || '';
        break;
      case 'status':
        display = value.status?.name || '';
        break;
      default:
        display = JSON.stringify(value[type] ?? '');
    }
    if (display) lines.push(`  ${key}：${display}`);
  }
  return lines.join('\n');
}

/** 将块转为可读文本 */
function blockToText(block: any): string {
  const type = block.type;
  const data = block[type];
  if (!data) return '';

  // 提取富文本内容
  const richText = data.rich_text || data.text;
  const text = richText?.map((t: any) => t.plain_text).join('') || '';

  switch (type) {
    case 'paragraph':
      return text;
    case 'heading_1':
      return `# ${text}`;
    case 'heading_2':
      return `## ${text}`;
    case 'heading_3':
      return `### ${text}`;
    case 'bulleted_list_item':
      return `- ${text}`;
    case 'numbered_list_item':
      return `1. ${text}`;
    case 'to_do':
      return `[${data.checked ? 'x' : ' '}] ${text}`;
    case 'toggle':
      return `> ${text}`;
    case 'quote':
      return `> ${text}`;
    case 'code':
      return `\`\`\`${data.language || ''}\n${text}\n\`\`\``;
    case 'callout':
      return `💡 ${text}`;
    case 'divider':
      return '---';
    case 'image':
      return `[图片: ${data.external?.url || data.file?.url || ''}]`;
    case 'bookmark':
      return `[书签: ${data.url || ''}]`;
    case 'embed':
      return `[嵌入: ${data.url || ''}]`;
    case 'table_of_contents':
      return '[目录]';
    default:
      return text || `[${type}]`;
  }
}

/** 创建处理函数 */
function createHandlers(client: NotionClient): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 创建页面
  handlers.set('create_page', async (ctx) => {
    try {
      const { database_id, title, content } = ctx.args as Record<string, any>;
      if (!database_id) return '错误：请提供数据库 ID（database_id）';
      if (!title) return '错误：请提供页面标题（title）';

      const result = await client.createPage(database_id, title, undefined, content);

      return `页面创建成功！\n标题：${title}\n页面 ID：${result.pageId}\n链接：${result.url}`;
    } catch (err: any) {
      return `创建页面失败：${err.message}`;
    }
  });

  // 获取页面
  handlers.set('get_page', async (ctx) => {
    try {
      const { page_id } = ctx.args as Record<string, any>;
      if (!page_id) return '错误：请提供页面 ID（page_id）';

      const page = await client.getPage(page_id as string);
      const title = extractPageTitle(page);
      const url = page.url || '无链接';
      const createdTime = new Date(page.created_time).toLocaleString('zh-CN');
      const lastEdited = new Date(page.last_edited_time).toLocaleString('zh-CN');
      const archived = page.archived ? '是' : '否';
      const props = formatProperties(page.properties || {});

      return [
        `页面：${title}`,
        `链接：${url}`,
        `创建时间：${createdTime}`,
        `最后编辑：${lastEdited}`,
        `已归档：${archived}`,
        props ? `\n属性：\n${props}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    } catch (err: any) {
      return `获取页面失败：${err.message}`;
    }
  });

  // 更新页面属性
  handlers.set('update_page', async (ctx) => {
    try {
      const { page_id, properties } = ctx.args as Record<string, any>;
      if (!page_id) return '错误：请提供页面 ID（page_id）';
      if (!properties) return '错误：请提供要更新的属性（properties），JSON 格式';

      let parsed: Record<string, any>;
      try {
        parsed = typeof properties === 'string' ? JSON.parse(properties) : properties;
      } catch {
        return '错误：properties 不是合法的 JSON 格式';
      }

      await client.updatePage(page_id as string, parsed);
      return `页面属性更新成功！（页面 ID：${page_id}）`;
    } catch (err: any) {
      return `更新页面失败：${err.message}`;
    }
  });

  // 读取页面内容
  handlers.set('read_page_content', async (ctx) => {
    try {
      const { page_id, count } = ctx.args as Record<string, any>;
      if (!page_id) return '错误：请提供页面 ID（page_id）';

      const pageSize = (count as number) ?? 50;
      const blocks = await client.getBlocks(page_id as string, pageSize);

      if (blocks.length === 0) {
        return '该页面没有内容';
      }

      const lines = blocks
        .map((block: any) => blockToText(block))
        .filter((line: string) => line !== '');

      return `页面内容（共 ${blocks.length} 个块）：\n\n${lines.join('\n')}`;
    } catch (err: any) {
      return `读取页面内容失败：${err.message}`;
    }
  });

  return handlers;
}

export const pageTools: ToolModule = { definitions, createHandlers };
