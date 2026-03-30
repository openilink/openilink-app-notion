/**
 * 应用配置接口与加载逻辑
 * 注意：notionToken 在云端托管模式下为可选，用户会在 OAuth setup 页面自行填写并加密存储到本地数据库。
 */

/** 全局配置项 */
export interface Config {
  /** HTTP 服务端口，默认 "8087" */
  port: string;
  /** Hub 服务地址，必填 */
  hubUrl: string;
  /** 本 App 的公网回调地址，必填 */
  baseUrl: string;
  /** SQLite 数据库文件路径，默认 "data/notion.db" */
  dbPath: string;
  /** Notion Integration Token（ntn_ 开头，可选，云端托管模式下由用户在安装时填写） */
  notionToken: string;
  /** 默认写入的 Notion 数据库 ID，可选 */
  notionDatabaseId: string;
}

/** 从环境变量加载配置 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const config: Config = {
    port: env.PORT?.trim() || "8087",
    hubUrl: env.HUB_URL?.trim() || "",
    baseUrl: env.BASE_URL?.trim() || "",
    dbPath: env.DB_PATH?.trim() || "data/notion.db",
    notionToken: env.NOTION_TOKEN?.trim() || "",
    notionDatabaseId: env.NOTION_DATABASE_ID?.trim() || "",
  };

  // 只有 Hub 和 BaseURL 是必填，Notion Token 在云端托管模式下由用户安装时填写
  const required: (keyof Config)[] = ["hubUrl", "baseUrl"];
  for (const key of required) {
    if (!config[key]) {
      throw new Error(`缺少必填配置: ${key}（对应环境变量: ${toEnvName(key)}）`);
    }
  }

  // 校验 Notion Token 格式（仅在提供了 token 时校验）
  if (config.notionToken && !config.notionToken.startsWith("ntn_")) {
    throw new Error("NOTION_TOKEN 格式不正确，应以 ntn_ 开头");
  }

  return config;
}

/** 将 camelCase 转为 UPPER_SNAKE_CASE */
function toEnvName(key: string): string {
  return key.replace(/([A-Z])/g, "_$1").toUpperCase();
}
