/**
 * 块操作工具模块
 */
import type { ToolModule, ToolDefinition, ToolHandler } from '../hub/types.js';
import type { NotionClient } from '../notion/client.js';

/** 工具定义 */
const definitions: ToolDefinition[] = [
  {
    name: 'append_content',
    description: '向 Notion 页面追加内容块',
    command: 'append_content',
    parameters: {
      page_id: { type: 'string', description: '页面 ID', required: true },
      content: { type: 'string', description: '要追加的文本内容', required: true },
      type: {
        type: 'string',
        description: '块类型：paragraph（段落）、heading（标题）、todo（待办），默认 paragraph',
        enum: ['paragraph', 'heading', 'todo'],
      },
    },
  },
  {
    name: 'append_todo',
    description: '向 Notion 页面添加待办事项',
    command: 'append_todo',
    parameters: {
      page_id: { type: 'string', description: '页面 ID', required: true },
      text: { type: 'string', description: '待办事项内容', required: true },
      checked: { type: 'boolean', description: '是否已完成，默认 false' },
    },
  },
  {
    name: 'delete_block',
    description: '删除 Notion 中的指定块',
    command: 'delete_block',
    parameters: {
      block_id: { type: 'string', description: '要删除的块 ID', required: true },
    },
  },
];

/** 创建处理函数 */
function createHandlers(client: NotionClient): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 追加内容
  handlers.set('append_content', async (ctx) => {
    try {
      const { page_id, content, type } = ctx.args as Record<string, any>;
      if (!page_id) return '错误：请提供页面 ID（page_id）';
      if (!content) return '错误：请提供要追加的内容（content）';

      const { NotionClient: NC } = await import('../notion/client.js');

      let block: any;
      switch (type) {
        case 'heading':
          block = NC.headingBlock(content as string, 2);
          break;
        case 'todo':
          block = NC.todoBlock(content as string, false);
          break;
        case 'paragraph':
        default:
          block = NC.textBlock(content as string);
          break;
      }

      await client.appendBlocks(page_id as string, [block]);

      const typeLabel = type === 'heading' ? '标题' : type === 'todo' ? '待办' : '段落';
      return `已成功追加${typeLabel}内容到页面（页面 ID：${page_id}）`;
    } catch (err: any) {
      return `追加内容失败：${err.message}`;
    }
  });

  // 添加待办
  handlers.set('append_todo', async (ctx) => {
    try {
      const { page_id, text, checked } = ctx.args as Record<string, any>;
      if (!page_id) return '错误：请提供页面 ID（page_id）';
      if (!text) return '错误：请提供待办事项内容（text）';

      const { NotionClient: NC } = await import('../notion/client.js');
      const isChecked = (checked as boolean) ?? false;
      const block = NC.todoBlock(text as string, isChecked);

      await client.appendBlocks(page_id as string, [block]);

      const status = isChecked ? '已完成' : '未完成';
      return `已添加待办事项：「${text}」（状态：${status}，页面 ID：${page_id}）`;
    } catch (err: any) {
      return `添加待办事项失败：${err.message}`;
    }
  });

  // 删除块
  handlers.set('delete_block', async (ctx) => {
    try {
      const { block_id } = ctx.args as Record<string, any>;
      if (!block_id) return '错误：请提供块 ID（block_id）';

      await client.deleteBlock(block_id as string);
      return `块已成功删除（块 ID：${block_id}）`;
    } catch (err: any) {
      return `删除块失败：${err.message}`;
    }
  });

  return handlers;
}

export const blockTools: ToolModule = { definitions, createHandlers };
