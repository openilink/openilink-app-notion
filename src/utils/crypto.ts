/**
 * 加密工具：HMAC 签名验证 + PKCE 码生成
 *
 * 签名规范：
 *   签名头: X-Timestamp + X-Signature
 *   算法: HMAC-SHA256(secret, timestamp + ":" + body)
 *   格式: "sha256=" + hex(digest)
 *
 * PKCE 规范：
 *   code_verifier: 32 字节随机数, base64url 编码
 *   code_challenge: SHA256(code_verifier), base64url 编码
 */

import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * 验证 Webhook 签名
 * @param secret - Webhook 密钥
 * @param timestamp - X-Timestamp 头的值
 * @param body - 原始请求体（Buffer）
 * @param signature - X-Signature 头的值，格式 "sha256=xxx"
 * @returns 签名是否匹配
 */
export function verifySignature(
  secret: string,
  timestamp: string,
  body: Buffer,
  signature: string,
): boolean {
  if (!secret || !timestamp || !signature) return false;

  const mac = createHmac("sha256", secret);
  mac.update(timestamp + ":");
  mac.update(body);
  const expected = "sha256=" + mac.digest("hex");

  // 长度不一致时直接返回 false，避免 timingSafeEqual 抛异常
  if (expected.length !== signature.length) return false;

  return timingSafeEqual(
    Buffer.from(expected, "utf-8"),
    Buffer.from(signature, "utf-8"),
  );
}

/** PKCE 码对 */
export interface PKCEPair {
  /** 随机生成的 code_verifier（base64url） */
  codeVerifier: string;
  /** 对应的 code_challenge（S256, base64url） */
  codeChallenge: string;
}

/**
 * 生成 OAuth PKCE 码对（S256 方式）
 * code_verifier: 32 字节随机数, base64url 编码
 * code_challenge: SHA256(code_verifier), base64url 编码
 */
export function generatePKCE(): PKCEPair {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return { codeVerifier, codeChallenge };
}
