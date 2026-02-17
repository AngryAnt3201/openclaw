import { describe, it, expect } from "vitest";
import type { CredentialSecret } from "./types.js";
import {
  encryptSecret,
  decryptSecret,
  createMasterKeyCheck,
  validateMasterKey,
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
});
