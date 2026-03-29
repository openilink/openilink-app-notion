import type { NotionClient } from './client.js';

/**
 * Notion 页面变更事件
 */
export interface NotionChangeEvent {
  /** 页面 ID */
  pageId: string;
  /** 页面标题 */
  title: string;
  /** 最后编辑时间（ISO 字符串） */
  lastEditedTime: string;
  /** 页面 URL */
  url: string;
}

/**
 * Notion 变更事件处理器
 */
export type NotionChangeHandler = (event: NotionChangeEvent) => void | Promise<void>;

/**
 * 从 Notion 页面对象中提取标题
 * @param page Notion 页面对象
 * @returns 页面标题字符串
 */
function extractTitle(page: any): string {
  const properties = page.properties ?? {};
  // 遍历属性，查找 title 类型的属性
  for (const key of Object.keys(properties)) {
    const prop = properties[key];
    if (prop?.type === 'title' && Array.isArray(prop.title)) {
      return prop.title.map((t: any) => t.plain_text ?? '').join('');
    }
  }
  return '无标题';
}

/**
 * 启动 Notion 数据库轮询
 *
 * 定期查询数据库中最近修改的页面，检测新变更并触发回调。
 * 内部记录上一次检查时间，只有在该时间之后编辑的页面才会触发事件。
 *
 * @param client NotionClient 实例
 * @param databaseId 要轮询的数据库 ID
 * @param onChange 变更回调
 * @param intervalMs 轮询间隔（毫秒），默认 60 秒
 * @returns 包含 stop 方法的对象，用于停止轮询
 */
export function startNotionPolling(
  client: NotionClient,
  databaseId: string,
  onChange: NotionChangeHandler,
  intervalMs: number = 60_000,
): { stop: () => void } {
  // 上一次检查的时间戳，初始化为当前时间
  let lastCheckedTime = new Date().toISOString();
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  /**
   * 执行一次轮询检查
   */
  async function poll(): Promise<void> {
    if (stopped) return;

    try {
      // 查询数据库，按最后编辑时间降序排列
      const results = await client.queryDatabase(
        databaseId,
        {
          timestamp: 'last_edited_time',
          last_edited_time: {
            after: lastCheckedTime,
          },
        },
        [{ timestamp: 'last_edited_time', direction: 'descending' }],
        50,
      );

      if (results.length === 0) return;

      // 更新检查时间为最新一条记录的编辑时间
      const latestTime = (results[0] as any).last_edited_time;
      if (latestTime) {
        lastCheckedTime = latestTime;
      }

      // 逐一触发变更事件（从旧到新）
      for (const page of results.reverse()) {
        const event: NotionChangeEvent = {
          pageId: page.id,
          title: extractTitle(page),
          lastEditedTime: (page as any).last_edited_time ?? '',
          url: (page as any).url ?? '',
        };

        try {
          await onChange(event);
        } catch (handlerError) {
          console.error('[NotionPolling] 变更处理器执行出错:', handlerError);
        }
      }
    } catch (error) {
      console.error('[NotionPolling] 轮询查询失败:', error);
    }
  }

  // 立即执行一次（但不阻塞返回）
  void poll();

  // 设置定时轮询
  timer = setInterval(() => void poll(), intervalMs);

  return {
    /** 停止轮询 */
    stop() {
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      console.log('[NotionPolling] 轮询已停止');
    },
  };
}
