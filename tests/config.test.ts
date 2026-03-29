/**
 * 配置模块测试
 */
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  /** 提供完整的最小合法环境变量 */
  const validEnv = {
    HUB_URL: "https://hub.example.com",
    BASE_URL: "https://app.example.com",
    NOTION_TOKEN: "ntn_test_token_123",
  };

  it("使用默认端口 8087", () => {
    const config = loadConfig(validEnv);
    expect(config.port).toBe("8087");
  });

  it("可以通过 PORT 覆盖默认端口", () => {
    const config = loadConfig({ ...validEnv, PORT: "3000" });
    expect(config.port).toBe("3000");
  });

  it("使用默认数据库路径 data/notion.db", () => {
    const config = loadConfig(validEnv);
    expect(config.dbPath).toBe("data/notion.db");
  });

  it("可以通过 DB_PATH 覆盖数据库路径", () => {
    const config = loadConfig({ ...validEnv, DB_PATH: "/tmp/test.db" });
    expect(config.dbPath).toBe("/tmp/test.db");
  });

  it("notionDatabaseId 默认为空字符串", () => {
    const config = loadConfig(validEnv);
    expect(config.notionDatabaseId).toBe("");
  });

  it("可以设置 NOTION_DATABASE_ID", () => {
    const config = loadConfig({ ...validEnv, NOTION_DATABASE_ID: "abc123" });
    expect(config.notionDatabaseId).toBe("abc123");
  });

  // 必填项校验
  it("缺少 HUB_URL 时抛出异常", () => {
    expect(() =>
      loadConfig({ BASE_URL: "https://app.example.com", NOTION_TOKEN: "ntn_test" }),
    ).toThrow("HUB_URL");
  });

  it("缺少 BASE_URL 时抛出异常", () => {
    expect(() =>
      loadConfig({ HUB_URL: "https://hub.example.com", NOTION_TOKEN: "ntn_test" }),
    ).toThrow("BASE_URL");
  });

  it("缺少 NOTION_TOKEN 时抛出异常", () => {
    expect(() =>
      loadConfig({ HUB_URL: "https://hub.example.com", BASE_URL: "https://app.example.com" }),
    ).toThrow("NOTION_TOKEN");
  });

  it("NOTION_TOKEN 格式不正确（不以 ntn_ 开头）时抛出异常", () => {
    expect(() =>
      loadConfig({
        HUB_URL: "https://hub.example.com",
        BASE_URL: "https://app.example.com",
        NOTION_TOKEN: "invalid_token",
      }),
    ).toThrow("ntn_");
  });

  it("正确加载所有配置项", () => {
    const config = loadConfig({
      PORT: "9090",
      HUB_URL: "https://hub.example.com",
      BASE_URL: "https://app.example.com",
      DB_PATH: "/data/my.db",
      NOTION_TOKEN: "ntn_abc123",
      NOTION_DATABASE_ID: "db-001",
    });

    expect(config).toEqual({
      port: "9090",
      hubUrl: "https://hub.example.com",
      baseUrl: "https://app.example.com",
      dbPath: "/data/my.db",
      notionToken: "ntn_abc123",
      notionDatabaseId: "db-001",
    });
  });
});
