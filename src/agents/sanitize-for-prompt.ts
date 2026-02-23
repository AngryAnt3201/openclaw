// ---------------------------------------------------------------------------
// sanitize-for-prompt – strip control/format characters from untrusted strings
// before embedding them into LLM prompts.
// ---------------------------------------------------------------------------
// Threat model (OC-19): attacker-controlled directory names (or other runtime
// strings) containing newline/control characters can break prompt structure
// and inject arbitrary instructions.
//
// Strategy: strip Unicode Cc (control) + Cf (format) characters (includes
// CR/LF/NUL, bidi marks, zero-width chars) and explicit line/paragraph
// separators Zl/Zp (U+2028/U+2029).
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/**
 * Sanitize untrusted strings before embedding them into an LLM prompt.
 *
 * This is intentionally lossy — it trades edge-case path fidelity for prompt
 * integrity. If you need lossless representation, escape instead of stripping.
 */
export function sanitizeForPromptLiteral(value: string): string {
  return value.replace(UNSAFE_CHARS, "");
}
