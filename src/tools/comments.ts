/**
 * 评论工具模块
 */
import type { ToolModule, ToolDefinition, ToolHandler } from '../hub/types.js';
import type { NotionClient } from '../notion/client.js';

/** 工具定义 */
const definitions: ToolDefinition[] = [
  {
    name: 'list_comments',
    description: '查看 Notion 页面上的评论',
    command: 'list_comments',
    parameters: {
      page_id: { type: 'string', description: '页面 ID', required: true },
    },
  },
  {
    name: 'create_comment',
    description: '在 Notion 页面上创建评论',
    command: 'create_comment',
    parameters: {
      page_id: { type: 'string', description: '页面 ID', required: true },
      content: { type: 'string', description: '评论内容', required: true },
    },
  },
];

/** 创建处理函数 */
function createHandlers(client: NotionClient): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 列出评论
  handlers.set('list_comments', async (ctx) => {
    try {
      const { page_id } = ctx.args as Record<string, any>;
      if (!page_id) return '错误：请提供页面 ID（page_id）';

      const comments = await client.listComments(page_id as string);

      if (comments.length === 0) {
        return '该页面暂无评论';
      }

      const lines = comments.map((comment: any, i: number) => {
        // 提取评论文本
        const text =
          comment.rich_text?.map((t: any) => t.plain_text).join('') || '（空评论）';
        const createdTime = comment.created_time
          ? new Date(comment.created_time).toLocaleString('zh-CN')
          : '未知时间';
        const author = comment.created_by?.name || comment.created_by?.id || '未知用户';
        return `${i + 1}. [${createdTime}] ${author}：${text}`;
      });

      return `共 ${comments.length} 条评论：\n\n${lines.join('\n')}`;
    } catch (err: any) {
      return `获取评论失败：${err.message}`;
    }
  });

  // 创建评论
  handlers.set('create_comment', async (ctx) => {
    try {
      const { page_id, content } = ctx.args as Record<string, any>;
      if (!page_id) return '错误：请提供页面 ID（page_id）';
      if (!content) return '错误：请提供评论内容（content）';

      await client.createComment(page_id as string, content as string);
      return `评论已成功创建（页面 ID：${page_id}）`;
    } catch (err: any) {
      return `创建评论失败：${err.message}`;
    }
  });

  return handlers;
}

export const commentTools: ToolModule = { definitions, createHandlers };
