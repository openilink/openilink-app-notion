/**
 * 加密工具测试
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySignature, generatePKCE } from "../../src/utils/crypto.js";

describe("verifySignature", () => {
  const secret = "test-webhook-secret";
  const payload = '{"type":"event","data":"hello"}';

  /** 生成正确的 HMAC 签名 */
  function makeSignature(data: string, key: string): string {
    return createHmac("sha256", key).update(data).digest("hex");
  }

  it("正确的签名返回 true", () => {
    const sig = makeSignature(payload, secret);
    expect(verifySignature(payload, sig, secret)).toBe(true);
  });

  it("错误的签名返回 false", () => {
    expect(verifySignature(payload, "wrong-signature", secret)).toBe(false);
  });

  it("空签名返回 false", () => {
    expect(verifySignature(payload, "", secret)).toBe(false);
  });

  it("空密钥返回 false", () => {
    const sig = makeSignature(payload, secret);
    expect(verifySignature(payload, sig, "")).toBe(false);
  });

  it("不同 payload 签名不匹配", () => {
    const sig = makeSignature(payload, secret);
    expect(verifySignature("different-payload", sig, secret)).toBe(false);
  });

  it("支持 Buffer 类型的 payload", () => {
    const buf = Buffer.from(payload, "utf-8");
    const sig = makeSignature(payload, secret);
    expect(verifySignature(buf, sig, secret)).toBe(true);
  });
});

describe("generatePKCE", () => {
  it("返回 codeVerifier 和 codeChallenge", () => {
    const pkce = generatePKCE();
    expect(pkce).toHaveProperty("codeVerifier");
    expect(pkce).toHaveProperty("codeChallenge");
  });

  it("codeVerifier 是非空字符串", () => {
    const { codeVerifier } = generatePKCE();
    expect(codeVerifier).toBeTruthy();
    expect(typeof codeVerifier).toBe("string");
    expect(codeVerifier.length).toBeGreaterThan(20);
  });

  it("codeChallenge 是非空字符串", () => {
    const { codeChallenge } = generatePKCE();
    expect(codeChallenge).toBeTruthy();
    expect(typeof codeChallenge).toBe("string");
  });

  it("每次调用生成不同的码对", () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });

  it("codeChallenge 是 codeVerifier 的 SHA256 Base64URL 摘要", async () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update(codeVerifier).digest("base64url");
    expect(codeChallenge).toBe(expected);
  });
});
