// OSC: ESC ] <payload> terminated by BEL (\x07) or ST (ESC \)
// Covers all OSC types: window titles (0/1/2), hyperlinks (8), clipboard (52), etc.
const OSC_PATTERN = "\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)";

// CSI: ESC [ <params> <final_byte>  — SGR, cursor movement, erase, etc.
const CSI_PATTERN = "\\x1b\\[[0-9;]*[A-Za-z@]";

const STRIP_REGEX = new RegExp(`${OSC_PATTERN}|${CSI_PATTERN}`, "g");

export function stripAnsi(input: string): string {
  return input.replace(STRIP_REGEX, "");
}

export function visibleWidth(input: string): number {
  return Array.from(stripAnsi(input)).length;
}

/**
 * Checks whether the last non-empty line of `text` ends with `suffix`.
 * Trims trailing whitespace from the last non-empty line before checking.
 */
export function lastLineEndsWith(text: string, suffix: string): boolean {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trimEnd();
    if (trimmed.length > 0) {
      return trimmed.endsWith(suffix);
    }
  }
  return false;
}
