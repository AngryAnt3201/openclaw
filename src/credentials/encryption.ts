// ---------------------------------------------------------------------------
// Credential Manager – Encryption (AES-256-GCM with scrypt KDF)
// ---------------------------------------------------------------------------

import * as crypto from "node:crypto";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CredentialSecret, EncryptedEnvelope } from "./types.js";
import { KDF_DEFAULTS, MASTER_KEY_CHECK_SENTINEL, resolveKeyfilePath } from "./constants.js";

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

function deriveKey(
  passphrase: string,
  salt: Buffer,
  params: { N: number; r: number; p: number; dkLen: number } = KDF_DEFAULTS,
): Buffer {
  return crypto.scryptSync(passphrase, salt, params.dkLen, {
    N: params.N,
    r: params.r,
    p: params.p,
  });
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt
// ---------------------------------------------------------------------------

export function encryptSecret(secret: CredentialSecret, passphrase: string): EncryptedEnvelope {
  const salt = crypto.randomBytes(32);
  const key = deriveKey(passphrase, salt);
  const nonce = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = JSON.stringify(secret);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    algorithm: "aes-256-gcm",
    kdfParams: {
      salt: salt.toString("base64"),
      N: KDF_DEFAULTS.N,
      r: KDF_DEFAULTS.r,
      p: KDF_DEFAULTS.p,
      dkLen: KDF_DEFAULTS.dkLen,
    },
    nonce: nonce.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecret(envelope: EncryptedEnvelope, passphrase: string): CredentialSecret {
  const salt = Buffer.from(envelope.kdfParams.salt, "base64");
  const key = deriveKey(passphrase, salt, envelope.kdfParams);
  const nonce = Buffer.from(envelope.nonce, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const tag = Buffer.from(envelope.tag, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(decrypted.toString("utf-8")) as CredentialSecret;
}

// ---------------------------------------------------------------------------
// Master key check (validate key without full decryption)
// ---------------------------------------------------------------------------

export function createMasterKeyCheck(passphrase: string): string {
  const envelope = encryptSecret({ kind: "api_key", key: MASTER_KEY_CHECK_SENTINEL }, passphrase);
  return JSON.stringify(envelope);
}

export function validateMasterKey(checkBlob: string, passphrase: string): boolean {
  try {
    const envelope = JSON.parse(checkBlob) as EncryptedEnvelope;
    const secret = decryptSecret(envelope, passphrase);
    return (
      secret.kind === "api_key" && (secret as { key: string }).key === MASTER_KEY_CHECK_SENTINEL
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Master key resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the master passphrase from (in priority order):
 * 1. `OPENCLAW_CREDENTIAL_KEY` env var
 * 2. `~/.openclaw/credentials/.keyfile` (auto-generated if missing)
 */
export async function resolveMasterKey(): Promise<string> {
  // 1. Environment variable
  const envKey = process.env.OPENCLAW_CREDENTIAL_KEY;
  if (envKey && envKey.trim()) {
    return envKey.trim();
  }

  // 2. Keyfile
  const keyfilePath = resolveKeyfilePath();
  if (existsSync(keyfilePath)) {
    const content = await fs.readFile(keyfilePath, "utf-8");
    if (content.trim()) {
      return content.trim();
    }
  }

  // 3. Auto-generate keyfile
  const dir = path.dirname(keyfilePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const generated = crypto.randomBytes(48).toString("base64");
  await fs.writeFile(keyfilePath, generated, "utf-8");
  chmodSync(keyfilePath, 0o600);

  return generated;
}
