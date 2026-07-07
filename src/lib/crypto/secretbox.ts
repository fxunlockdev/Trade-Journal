import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Authenticated encryption for credentials at rest (AES-256-GCM).
 *
 * Format: base64("v1" is implied) of `iv(12) || authTag(16) || ciphertext`.
 * Key comes from CREDENTIALS_ENCRYPTION_KEY — 64 hex chars (32 bytes),
 * generated once with `openssl rand -hex 32`. Server-only module.
 *
 * A DB leak without the env key reveals nothing; rotating the key requires
 * re-encrypting rows (out of scope — document if ever needed).
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not configured (expected 64 hex chars — generate with `openssl rand -hex 32`).",
    );
  }
  return Buffer.from(hex, "hex");
}

/** True when the encryption key is configured — used for friendly 503s. */
export function credentialsKeyConfigured(): boolean {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  return Boolean(hex && /^[0-9a-fA-F]{64}$/.test(hex));
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const key = getKey();
  const raw = Buffer.from(encoded, "base64");
  if (raw.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("Corrupt encrypted payload");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
