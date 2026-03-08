import { describe, expect, it } from "vitest";
import {
  formatOutboundPayloadLog,
  normalizeOutboundPayloads,
  normalizeOutboundPayloadsForJson,
  redactUrl,
  redactHeaders,
  redactSensitive,
} from "./payloads.js";

describe("normalizeOutboundPayloadsForJson", () => {
  it("normalizes payloads with mediaUrl and mediaUrls", () => {
    expect(
      normalizeOutboundPayloadsForJson([
        { text: "hi" },
        { text: "photo", mediaUrl: "https://x.test/a.jpg" },
        { text: "multi", mediaUrls: ["https://x.test/1.png"] },
      ]),
    ).toEqual([
      { text: "hi", mediaUrl: null, mediaUrls: undefined, channelData: undefined },
      {
        text: "photo",
        mediaUrl: "https://x.test/a.jpg",
        mediaUrls: ["https://x.test/a.jpg"],
        channelData: undefined,
      },
      {
        text: "multi",
        mediaUrl: null,
        mediaUrls: ["https://x.test/1.png"],
        channelData: undefined,
      },
    ]);
  });

  it("keeps mediaUrl null for multi MEDIA tags", () => {
    expect(
      normalizeOutboundPayloadsForJson([
        {
          text: "MEDIA:https://x.test/a.png\nMEDIA:https://x.test/b.png",
        },
      ]),
    ).toEqual([
      {
        text: "",
        mediaUrl: null,
        mediaUrls: ["https://x.test/a.png", "https://x.test/b.png"],
        channelData: undefined,
      },
    ]);
  });
});

describe("normalizeOutboundPayloads", () => {
  it("keeps channelData-only payloads", () => {
    const channelData = { line: { flexMessage: { altText: "Card", contents: {} } } };
    const normalized = normalizeOutboundPayloads([{ channelData }]);
    expect(normalized).toEqual([{ text: "", mediaUrls: [], channelData }]);
  });
});

describe("formatOutboundPayloadLog", () => {
  it("trims trailing text and appends media lines", () => {
    expect(
      formatOutboundPayloadLog({
        text: "hello  ",
        mediaUrls: ["https://x.test/a.png", "https://x.test/b.png"],
      }),
    ).toBe("hello\nMEDIA:https://x.test/a.png\nMEDIA:https://x.test/b.png");
  });

  it("logs media-only payloads", () => {
    expect(
      formatOutboundPayloadLog({
        text: "",
        mediaUrls: ["https://x.test/a.png"],
      }),
    ).toBe("MEDIA:https://x.test/a.png");
  });

  it("redacts API keys in media URLs", () => {
    expect(
      formatOutboundPayloadLog({
        text: "",
        mediaUrls: ["https://api.example.com/image?key=sk-abc123&size=large"],
      }),
    ).toBe("MEDIA:https://api.example.com/image?key=[REDACTED]&size=large");
  });

  it("redacts sensitive params in text content", () => {
    expect(
      formatOutboundPayloadLog({
        text: "Check https://api.test/v1?api_key=secret123&format=json  ",
        mediaUrls: [],
      }),
    ).toBe("Check https://api.test/v1?api_key=[REDACTED]&format=json");
  });

  it("redacts Authorization headers in text", () => {
    expect(
      formatOutboundPayloadLog({
        text: "Authorization: Bearer sk-live-abc123def456  ",
        mediaUrls: [],
      }),
    ).toBe("Authorization: Bearer [REDACTED]");
  });
});

describe("redactUrl", () => {
  it("redacts key= parameter", () => {
    expect(redactUrl("https://api.test/v1?key=abc123")).toBe("https://api.test/v1?key=[REDACTED]");
  });

  it("redacts token= parameter", () => {
    expect(redactUrl("https://api.test/v1?token=xyz789")).toBe(
      "https://api.test/v1?token=[REDACTED]",
    );
  });

  it("redacts api_key= parameter", () => {
    expect(redactUrl("https://api.test/v1?api_key=secret")).toBe(
      "https://api.test/v1?api_key=[REDACTED]",
    );
  });

  it("redacts apikey= parameter", () => {
    expect(redactUrl("https://api.test/v1?apikey=secret")).toBe(
      "https://api.test/v1?apikey=[REDACTED]",
    );
  });

  it("redacts access_token= parameter", () => {
    expect(redactUrl("https://api.test/v1?access_token=tok123")).toBe(
      "https://api.test/v1?access_token=[REDACTED]",
    );
  });

  it("redacts secret= parameter", () => {
    expect(redactUrl("https://api.test/v1?secret=s3cr3t")).toBe(
      "https://api.test/v1?secret=[REDACTED]",
    );
  });

  it("redacts multiple sensitive params in one URL", () => {
    expect(redactUrl("https://api.test/v1?key=abc&token=xyz&format=json")).toBe(
      "https://api.test/v1?key=[REDACTED]&token=[REDACTED]&format=json",
    );
  });

  it("leaves normal URLs unchanged", () => {
    expect(redactUrl("https://example.com/path?page=1&sort=asc")).toBe(
      "https://example.com/path?page=1&sort=asc",
    );
  });

  it("leaves URLs without query params unchanged", () => {
    expect(redactUrl("https://example.com/path")).toBe("https://example.com/path");
  });
});

describe("redactHeaders", () => {
  it("redacts Bearer token", () => {
    expect(redactHeaders("Authorization: Bearer sk-live-abc123")).toBe(
      "Authorization: Bearer [REDACTED]",
    );
  });

  it("redacts Basic auth", () => {
    expect(redactHeaders("Authorization: Basic dXNlcjpwYXNz")).toBe(
      "Authorization: Basic [REDACTED]",
    );
  });

  it("redacts Token auth", () => {
    expect(redactHeaders("Authorization: Token ghp_abc123")).toBe(
      "Authorization: Token [REDACTED]",
    );
  });

  it("leaves non-auth text unchanged", () => {
    expect(redactHeaders("Content-Type: application/json")).toBe("Content-Type: application/json");
  });
});

describe("redactSensitive", () => {
  it("redacts both URL params and auth headers", () => {
    const text = "Calling https://api.test/v1?key=abc123 with Authorization: Bearer sk-live-xyz";
    const result = redactSensitive(text);
    expect(result).toBe(
      "Calling https://api.test/v1?key=[REDACTED] with Authorization: Bearer [REDACTED]",
    );
  });

  it("leaves clean text unchanged", () => {
    expect(redactSensitive("Hello world")).toBe("Hello world");
  });
});
