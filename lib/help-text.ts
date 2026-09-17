/**
 * Splitting help text into plain and literal runs.
 *
 * The strings in `lib/field-spec` mark literal values with backticks — a format
 * to type like `HH00,lookback`, a value like `default`, a sheet tab called
 * `Manpower`. React renders a string verbatim, so until this existed those
 * arrived on screen as backtick characters: 32 of the 204 help strings showed
 * punctuation the writer meant as "this is the exact text", which reads as
 * noise in an 11px line and buries the one part the operator has to copy.
 *
 * Lives here rather than in the component because a pure split can be tested,
 * and a renderer that silently stopped marking code would otherwise look fine.
 */
export type HelpSegment = { text: string; code: boolean };

/**
 * Alternating runs, starting with a plain one.
 *
 * An odd number of backticks means the last one never closed. That run stays
 * plain rather than being marked up to the end of the sentence: an unclosed
 * quote is a typo in the help string, and swallowing the rest of the line would
 * make it look deliberate. Empty runs are dropped so `a``b` does not emit one.
 */
export function helpSegments(text: string): HelpSegment[] {
  const parts = text.split("`");
  const closed = parts.length % 2 === 1;
  return parts
    .map((part, index) => ({ text: part, code: closed && index % 2 === 1 }))
    .filter((segment) => segment.text !== "");
}
