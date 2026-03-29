import { Client } from '@notionhq/client';

/**
 * Notion SDK 封装类
 * 提供对 Notion API 的统一调用接口，包含搜索、页面、数据库、块、评论、用户等操作
 */
export class NotionClient {
  public sdk: Client;
  private defaultDatabaseId: string;

  constructor(token: string, defaultDatabaseId?: string) {
    this.sdk = new Client({ auth: token });
    this.defaultDatabaseId = defaultDatabaseId ?? '';
  }

  // ─── 搜索 ───────────────────────────────────────────────

  /**
   * 搜索 Notion 内容（页面或数据库）
   * @param query 搜索关键词
   * @param objectType 筛选对象类型：page 或 database
   * @param pageSize 返回结果数量上限
   */
  async search(
    query: string,
    objectType?: 'page' | 'database',
    pageSize: number = 20,
  ): Promise<any[]> {
    try {
      const params: Record<string, any> = { query, page_size: pageSize };
      if (objectType) {
        params.filter = { property: 'object', value: objectType };
      }
      const response = await this.sdk.search(params);
      return response.results;
    } catch (error) {
      console.error('[NotionClient] 搜索失败:', error);
      throw error;
    }
  }

  // ─── 页面操作 ──────────────────────────────────────────

  /**
   * 在指定数据库中创建页面
   * @param databaseId 目标数据库 ID，为空时使用默认数据库
   * @param title 页面标题
   * @param properties 额外属性（可选）
   * @param content 页面正文内容，传入后自动创建 paragraph block（可选）
   * @returns 新建页面的 ID 和 URL
   */
  async createPage(
    databaseId: string,
    title: string,
    properties?: Record<string, any>,
    content?: string,
  ): Promise<{ pageId: string; url: string }> {
    try {
      const dbId = databaseId || this.defaultDatabaseId;
      if (!dbId) {
        throw new Error('未指定 databaseId 且未设置默认数据库');
      }

      // 合并标题属性与额外属性
      const mergedProperties: Record<string, any> = {
        ...properties,
        Name: { title: [{ text: { content: title } }] },
      };

      // 如果提供了内容，创建 paragraph block 作为页面子元素
      const children: any[] = [];
      if (content) {
        children.push(NotionClient.textBlock(content));
      }

      const response = await this.sdk.pages.create({
        parent: { database_id: dbId },
        properties: mergedProperties,
        children,
      });

      return {
        pageId: response.id,
        url: (response as any).url ?? '',
      };
    } catch (error) {
      console.error('[NotionClient] 创建页面失败:', error);
      throw error;
    }
  }

  /**
   * 获取页面详情
   * @param pageId 页面 ID
   */
  async getPage(pageId: string): Promise<any> {
    try {
      return await this.sdk.pages.retrieve({ page_id: pageId });
    } catch (error) {
      console.error('[NotionClient] 获取页面失败:', error);
      throw error;
    }
  }

  /**
   * 更新页面属性
   * @param pageId 页面 ID
   * @param properties 要更新的属性
   */
  async updatePage(pageId: string, properties: Record<string, any>): Promise<void> {
    try {
      await this.sdk.pages.update({ page_id: pageId, properties });
    } catch (error) {
      console.error('[NotionClient] 更新页面失败:', error);
      throw error;
    }
  }

  // ─── 数据库操作 ─────────────────────────────────────────

  /**
   * 查询数据库中的页面
   * @param databaseId 数据库 ID，为空时使用默认数据库
   * @param filter 筛选条件
   * @param sorts 排序规则
   * @param pageSize 返回结果数量上限
   */
  async queryDatabase(
    databaseId: string,
    filter?: any,
    sorts?: any[],
    pageSize: number = 100,
  ): Promise<any[]> {
    try {
      const dbId = databaseId || this.defaultDatabaseId;
      if (!dbId) {
        throw new Error('未指定 databaseId 且未设置默认数据库');
      }

      const params: any = {
        database_id: dbId,
        page_size: pageSize,
      };
      if (filter) params.filter = filter;
      if (sorts) params.sorts = sorts;

      const response = await this.sdk.databases.query(params);
      return response.results;
    } catch (error) {
      console.error('[NotionClient] 查询数据库失败:', error);
      throw error;
    }
  }

  /**
   * 获取数据库详情
   * @param databaseId 数据库 ID
   */
  async getDatabase(databaseId: string): Promise<any> {
    try {
      return await this.sdk.databases.retrieve({ database_id: databaseId });
    } catch (error) {
      console.error('[NotionClient] 获取数据库失败:', error);
      throw error;
    }
  }

  // ─── 块操作 ─────────────────────────────────────────────

  /**
   * 获取指定块的子块列表
   * @param blockId 块 ID（也可以是页面 ID）
   * @param pageSize 返回结果数量上限
   */
  async getBlocks(blockId: string, pageSize: number = 100): Promise<any[]> {
    try {
      const response = await this.sdk.blocks.children.list({
        block_id: blockId,
        page_size: pageSize,
      });
      return response.results;
    } catch (error) {
      console.error('[NotionClient] 获取块列表失败:', error);
      throw error;
    }
  }

  /**
   * 向指定块追加子块
   * @param blockId 目标块 ID（也可以是页面 ID）
   * @param children 要追加的块数组
   */
  async appendBlocks(blockId: string, children: any[]): Promise<void> {
    try {
      await this.sdk.blocks.children.append({
        block_id: blockId,
        children,
      });
    } catch (error) {
      console.error('[NotionClient] 追加块失败:', error);
      throw error;
    }
  }

  /**
   * 删除指定块
   * @param blockId 块 ID
   */
  async deleteBlock(blockId: string): Promise<void> {
    try {
      await this.sdk.blocks.delete({ block_id: blockId });
    } catch (error) {
      console.error('[NotionClient] 删除块失败:', error);
      throw error;
    }
  }

  // ─── 评论 ───────────────────────────────────────────────

  /**
   * 获取指定块/页面的评论列表
   * @param blockId 块或页面 ID
   */
  async listComments(blockId: string): Promise<any[]> {
    try {
      const response = await this.sdk.comments.list({ block_id: blockId });
      return response.results;
    } catch (error) {
      console.error('[NotionClient] 获取评论失败:', error);
      throw error;
    }
  }

  /**
   * 在指定页面创建评论
   * @param pageId 页面 ID
   * @param content 评论内容
   */
  async createComment(pageId: string, content: string): Promise<void> {
    try {
      await this.sdk.comments.create({
        parent: { page_id: pageId },
        rich_text: [{ text: { content } }],
      });
    } catch (error) {
      console.error('[NotionClient] 创建评论失败:', error);
      throw error;
    }
  }

  // ─── 用户 ───────────────────────────────────────────────

  /**
   * 获取工作区用户列表
   */
  async listUsers(): Promise<any[]> {
    try {
      const response = await this.sdk.users.list({});
      return response.results;
    } catch (error) {
      console.error('[NotionClient] 获取用户列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取当前机器人用户信息
   */
  async getMe(): Promise<any> {
    try {
      return await this.sdk.users.me({});
    } catch (error) {
      console.error('[NotionClient] 获取当前用户失败:', error);
      throw error;
    }
  }

  // ─── 辅助方法：构建块对象 ──────────────────────────────

  /**
   * 创建段落文本块
   * @param content 文本内容
   */
  static textBlock(content: string): any {
    return {
      type: 'paragraph',
      paragraph: {
        rich_text: [{ text: { content } }],
      },
    };
  }

  /**
   * 创建标题块
   * @param content 标题内容
   * @param level 标题级别（1/2/3）
   */
  static headingBlock(content: string, level: 1 | 2 | 3 = 2): any {
    const type = `heading_${level}` as const;
    return {
      type,
      [type]: {
        rich_text: [{ text: { content } }],
      },
    };
  }

  /**
   * 创建待办事项块
   * @param content 待办内容
   * @param checked 是否已完成
   */
  static todoBlock(content: string, checked: boolean = false): any {
    return {
      type: 'to_do',
      to_do: {
        rich_text: [{ text: { content } }],
        checked,
      },
    };
  }
}
