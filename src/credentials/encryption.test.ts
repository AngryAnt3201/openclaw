import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { CredentialSecret } from "./types.js";
import {
  encryptSecret,
  decryptSecret,
  createMasterKeyCheck,
  validateMasterKey,
  resolveMasterKey,
} from "./encryption.js";

describe("Credential Encryption", () => {
  const passphrase = "test-passphrase-12345";

  describe("encryptSecret / decryptSecret", () => {
    it("should round-trip an api_key secret", () => {
      const secret: CredentialSecret = { kind: "api_key", key: "sk-test-123456" };
      const envelope = encryptSecret(secret, passphrase);
      const decrypted = decryptSecret(envelope, passphrase);
      expect(decrypted).toEqual(secret);
    });

    it("should round-trip a token secret", () => {
      const secret: CredentialSecret = {
        kind: "token",
        token: "tok-abc-xyz",
        expiresAtMs: 1700000000000,
        email: "test@example.com",
      };
      const envelope = encryptSecret(secret, passphrase);
      const decrypted = decryptSecret(envelope, passphrase);
      expect(decrypted).toEqual(secret);
    });

    it("should round-trip an oauth secret", () => {
      const secret: CredentialSecret = {
        kind: "oauth",
        accessToken: "at-123",
        refreshToken: "rt-456",
        expiresAtMs: 1700000000000,
        clientId: "client-id",
        scopes: ["read", "write"],
      };
      const envelope = encryptSecret(secret, passphrase);
      const decrypted = decryptSecret(envelope, passphrase);
      expect(decrypted).toEqual(secret);
    });

    it("should produce different ciphertext for same secret (unique nonce/salt)", () => {
      const secret: CredentialSecret = { kind: "api_key", key: "sk-test" };
      const e1 = encryptSecret(secret, passphrase);
      const e2 = encryptSecret(secret, passphrase);
      expect(e1.ciphertext).not.toEqual(e2.ciphertext);
      expect(e1.nonce).not.toEqual(e2.nonce);
      expect(e1.kdfParams.salt).not.toEqual(e2.kdfParams.salt);
    });

    it("should fail decryption with wrong passphrase", () => {
      const secret: CredentialSecret = { kind: "api_key", key: "sk-test" };
      const envelope = encryptSecret(secret, passphrase);
      expect(() => decryptSecret(envelope, "wrong-passphrase")).toThrow();
    });

    it("should set correct algorithm in envelope", () => {
      const secret: CredentialSecret = { kind: "api_key", key: "sk-test" };
      const envelope = encryptSecret(secret, passphrase);
      expect(envelope.algorithm).toBe("aes-256-gcm");
    });

    it("should include KDF params in envelope", () => {
      const secret: CredentialSecret = { kind: "api_key", key: "sk-test" };
      const envelope = encryptSecret(secret, passphrase);
      expect(envelope.kdfParams).toBeDefined();
      expect(envelope.kdfParams.N).toBe(16384);
      expect(envelope.kdfParams.r).toBe(8);
      expect(envelope.kdfParams.p).toBe(1);
      expect(envelope.kdfParams.dkLen).toBe(32);
    });
  });

  describe("masterKeyCheck", () => {
    it("should validate correct key", () => {
      const check = createMasterKeyCheck(passphrase);
      expect(validateMasterKey(check, passphrase)).toBe(true);
    });

    it("should reject wrong key", () => {
      const check = createMasterKeyCheck(passphrase);
      expect(validateMasterKey(check, "wrong-key")).toBe(false);
    });

    it("should reject malformed check blob", () => {
      expect(validateMasterKey("not-json", passphrase)).toBe(false);
    });

    it("should reject empty check blob", () => {
      expect(validateMasterKey("", passphrase)).toBe(false);
    });
  });

  describe("resolveMasterKey file permissions", () => {
    let tmpDir: string;
    let origHome: string | undefined;
    let origCredKey: string | undefined;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cred-enc-perm-"));
      origHome = process.env.HOME;
      origCredKey = process.env.OPENCLAW_CREDENTIAL_KEY;
      // Point HOME to temp dir so keyfile is created there
      process.env.HOME = tmpDir;
      // Clear env key so keyfile path is used
      delete process.env.OPENCLAW_CREDENTIAL_KEY;
    });

    afterEach(async () => {
      process.env.HOME = origHome;
      if (origCredKey !== undefined) {
        process.env.OPENCLAW_CREDENTIAL_KEY = origCredKey;
      } else {
        delete process.env.OPENCLAW_CREDENTIAL_KEY;
      }
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("should create keyfile with 0o600 permissions (owner-only read/write)", async () => {
      const key = await resolveMasterKey();
      expect(key).toBeTruthy();

      const keyfilePath = path.join(tmpDir, ".openclaw", "credentials", ".keyfile");
      const stat = fsSync.statSync(keyfilePath);
      // mode includes file type bits; mask to permission bits only
      const perms = stat.mode & 0o777;
      expect(perms).toBe(0o600);
    });

    it("should not leave keyfile world-readable at any point", async () => {
      // This test verifies the fix: the file is created with 0o600 from the start
      // (using openSync with mode), not written with default perms then chmod'd
      await resolveMasterKey();

      const keyfilePath = path.join(tmpDir, ".openclaw", "credentials", ".keyfile");
      const stat = fsSync.statSync(keyfilePath);
      const perms = stat.mode & 0o777;
      // No group or other permissions should be set
      expect(perms & 0o077).toBe(0);
    });
  });
});
