/**
 * 集成测试通用工具
 * 用于与 OpeniLink Hub Mock Server 交互
 */

export const MOCK_HUB_URL = "http://localhost:9801";
export const MOCK_APP_TOKEN = "mock_app_token";

/**
 * 向 Mock Server 注入一条模拟消息
 */
export async function injectMessage(sender: string, content: string): Promise<void> {
  await fetch(`${MOCK_HUB_URL}/mock/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, content }),
  });
}

/**
 * 获取 Mock Server 记录的所有消息
 */
export async function getMessages(): Promise<any[]> {
  const res = await fetch(`${MOCK_HUB_URL}/mock/messages`);
  const data = await res.json();
  return data.store_messages ?? data.messages ?? [];
}

/**
 * 重置 Mock Server 状态
 */
export async function resetMock(): Promise<void> {
  await fetch(`${MOCK_HUB_URL}/mock/reset`, { method: "POST" });
}

/**
 * 轮询等待条件满足，超时抛出错误
 */
export async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor 超时");
}
