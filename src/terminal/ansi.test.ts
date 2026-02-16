import { describe, it, expect } from "vitest";
import { stripAnsi, visibleWidth, lastLineEndsWith } from "./ansi.js";

describe("stripAnsi", () => {
  it("leaves plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("strips SGR color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m normal")).toBe("red normal");
  });

  it("strips combined SGR codes", () => {
    expect(stripAnsi("\x1b[1;32mbold green\x1b[0m")).toBe("bold green");
  });

  it("strips OSC-0 window title (BEL terminated)", () => {
    expect(stripAnsi("\x1b]0;title$PATH\x07prompt$ ")).toBe("prompt$ ");
  });

  it("strips OSC-0 window title (ST terminated)", () => {
    expect(stripAnsi("\x1b]0;title\x1b\\visible")).toBe("visible");
  });

  it("strips OSC-8 hyperlinks", () => {
    expect(stripAnsi("\x1b]8;;https://example.com\x1b\\click\x1b]8;;\x1b\\")).toBe("click");
  });

  it("strips $ inside OSC title — no false positive", () => {
    expect(stripAnsi("\x1b]0;~/proj$HOME\x07user@host:~$ ")).toBe("user@host:~$ ");
  });

  it("strips mixed CSI and OSC sequences", () => {
    expect(stripAnsi("\x1b]0;title\x07\x1b[32mgreen\x1b[0m text")).toBe("green text");
  });

  it("strips CSI cursor movement", () => {
    expect(stripAnsi("\x1b[Hhello\x1b[2J")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });
});

describe("visibleWidth", () => {
  it("counts visible characters after stripping ANSI", () => {
    expect(visibleWidth("\x1b[31mhi\x1b[0m")).toBe(2);
  });

  it("counts plain text length", () => {
    expect(visibleWidth("hello")).toBe(5);
  });
});

describe("lastLineEndsWith", () => {
  it("matches $ at end of last line", () => {
    expect(lastLineEndsWith("user@host:~$ ", "$")).toBe(true);
  });

  it("matches % at end of last line", () => {
    expect(lastLineEndsWith("host% ", "%")).toBe(true);
  });

  it("rejects $ in middle of line", () => {
    expect(lastLineEndsWith("export PATH=$HOME/bin", "$")).toBe(false);
  });

  it("rejects $ in MOTD text", () => {
    expect(lastLineEndsWith("Welcome!\nSet $EDITOR.\nLoading...", "$")).toBe(false);
  });

  it("matches prompt after MOTD", () => {
    expect(lastLineEndsWith("Welcome\nLast login: Mon\nuser@host:~$ ", "$")).toBe(true);
  });

  it("returns false for empty input", () => {
    expect(lastLineEndsWith("", "$")).toBe(false);
  });

  it("returns false for only whitespace", () => {
    expect(lastLineEndsWith("  \n  \n", "$")).toBe(false);
  });

  it("rejects > in HTML content", () => {
    expect(lastLineEndsWith("<html>\n</html>\nInit...", ">")).toBe(false);
  });
});
