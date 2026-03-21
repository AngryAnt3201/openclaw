import { describe, it, expect } from "vitest";
import { validateScraplingUrl } from "./scrapling.js";

describe("validateScraplingUrl", () => {
  // -------------------------------------------------------------------------
  // Localhost URLs — should pass
  // -------------------------------------------------------------------------
  it("accepts http://localhost:18790", () => {
    expect(validateScraplingUrl("http://localhost:18790")).toBe(true);
  });

  it("accepts http://127.0.0.1:18790", () => {
    expect(validateScraplingUrl("http://127.0.0.1:18790")).toBe(true);
  });

  it("accepts http://[::1]:18790", () => {
    expect(validateScraplingUrl("http://[::1]:18790")).toBe(true);
  });

  it("accepts https://localhost:18790", () => {
    expect(validateScraplingUrl("https://localhost:18790")).toBe(true);
  });

  it("accepts localhost without port", () => {
    expect(validateScraplingUrl("http://localhost")).toBe(true);
  });

  it("accepts localhost with path", () => {
    expect(validateScraplingUrl("http://localhost:18790/api/v1")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Non-localhost URLs — should be rejected
  // -------------------------------------------------------------------------
  it("rejects http://example.com:18790", () => {
    expect(validateScraplingUrl("http://example.com:18790")).toBe(false);
  });

  it("rejects http://192.168.1.100:18790", () => {
    expect(validateScraplingUrl("http://192.168.1.100:18790")).toBe(false);
  });

  it("rejects http://10.0.0.1:18790", () => {
    expect(validateScraplingUrl("http://10.0.0.1:18790")).toBe(false);
  });

  it("rejects http://attacker.localhost:18790 (subdomain)", () => {
    // URL parser treats "attacker.localhost" as a different hostname
    expect(validateScraplingUrl("http://attacker.localhost:18790")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Invalid URLs — should be rejected
  // -------------------------------------------------------------------------
  it("rejects empty string", () => {
    expect(validateScraplingUrl("")).toBe(false);
  });

  it("rejects non-URL string", () => {
    expect(validateScraplingUrl("not-a-url")).toBe(false);
  });

  it("rejects URL without protocol", () => {
    expect(validateScraplingUrl("localhost:18790")).toBe(false);
  });
});
