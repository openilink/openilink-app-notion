/**
 * AES-256-GCM 配置加解密工具
 *
 * 用于将从 Hub 拉取的敏感配置加密后存入本地 SQLite，
 * webhook 处理时再从本地读取并解密，避免明文存储。
 *
 * 密钥派生: 使用 app_token 的 SHA-256 哈希作为 256 位密钥
 * 加密格式: iv(12字节) + authTag(16字节) + ciphertext，整体 base64 编码
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/** AES-256-GCM 算法标识 */
const ALGORITHM = "aes-256-gcm";
/** IV 长度（字节） */
const IV_LENGTH = 12;
/** GCM AuthTag 长度（字节） */
const TAG_LENGTH = 16;

/**
 * 从 app_token 派生 256 位加密密钥
 * @param appToken - 安装时获取的 app_token
 * @returns 32 字节 Buffer 作为 AES-256 密钥
 */
function deriveKey(appToken: string): Buffer {
  return createHash("sha256").update(appToken).digest();
}

/**
 * 加密配置 JSON
 * @param plainObj - 明文配置对象
 * @param appToken - 用于派生密钥的 app_token
 * @returns base64 编码的密文字符串
 */
export function encryptConfig(
  plainObj: Record<string, string>,
  appToken: string,
): string {
  const key = deriveKey(appToken);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(plainObj);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // 拼接: iv + authTag + ciphertext
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString("base64");
}

/**
 * 解密配置 JSON
 * @param cipherBase64 - base64 编码的密文
 * @param appToken     - 用于派生密钥的 app_token
 * @returns 解密后的配置对象
 */
export function decryptConfig(
  cipherBase64: string,
  appToken: string,
): Record<string, string> {
  const key = deriveKey(appToken);
  const combined = Buffer.from(cipherBase64, "base64");

  // 拆分: iv(12) + authTag(16) + ciphertext(剩余)
  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf-8")) as Record<string, string>;
}
