#!/usr/bin/env node
/**
 * Extract the noise service's message shapes into a HALO data module.
 *
 * The noise repo already documents one section per formatter value in
 * `MESSAGE_SHAPES.md`, complete with the real WhatsApp text. Copying those by
 * hand into the dashboard would rot the moment a formatter changes, so this
 * script lifts them verbatim instead and writes `lib/message-previews.generated.ts`.
 *
 * It is a DEV tool, not part of the build: it needs the noise repo checked out
 * next to this one (a sibling directory), and its output is committed. Run it
 * after the noise repo's message shapes change:
 *
 *     node scripts/build-message-previews.mjs
 *     NOISE_REPO=/path/to/repo node scripts/build-message-previews.mjs
 *
 * WBGT and haze previews are NOT generated here — see lib/message-previews.ts
 * for why (their docs are organised by band, not by formatter value).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Where the noise repo is.
 *
 * Resolved as a SIBLING of this repo rather than from an absolute path under
 * $HOME. The absolute form was `~/Documents/GitHub/usecase-wohhup-noise-meter-alerts`,
 * and when the estate moved into `wh-centralised-services/` this script stopped
 * running — silently, because its output is committed and still looked right.
 * A relative sibling path survives the whole checkout being moved or renamed.
 */
const NOISE_REPO = process.env.NOISE_REPO ?? resolve(here, "../../usecase-wohhup-noise-meter-alerts");
const DOC = resolve(NOISE_REPO, "MESSAGE_SHAPES.md");
// Overridable so a test can regenerate into a temp file and compare, rather
// than having to write over the committed one to find out whether it is stale.
const OUT = process.env.PREVIEWS_OUT ?? resolve(here, "../lib/message-previews.generated.ts");

if (!existsSync(DOC)) {
  // Say which path was tried and how to override it. The previous failure was a
  // bare ENOENT stack trace, which does not tell a reader that NOISE_REPO exists.
  console.error(
    `Cannot read the noise repo's MESSAGE_SHAPES.md.\n` +
      `  looked in: ${DOC}\n` +
      `  override with: NOISE_REPO=/path/to/usecase-wohhup-noise-meter-alerts node scripts/build-message-previews.mjs`,
  );
  process.exit(1);
}

/** `## 7. \`half_hourly_formatter = all_5mins_list_Leq1hr\`` */
const KEYED_HEADER = /^## \d+\.\s+`([a-z0-9_]+)\s*=\s*([A-Za-z0-9_]+)`\s*$/;
/** Any h2. Needed to close a section: §16 has no `col = value` key, and without
 *  this the preceding section swallowed its examples. */
const ANY_HEADER = /^## /;

/**
 * The doc writes placeholders where the value depends on run time. A preview is
 * meant to look like a real message, so they are filled with the same concrete
 * values the doc's own "Real example shape" blocks use.
 */
function substitute(text) {
  const hourly = text.includes("10AM");
  return text
    .replace(/PROJECT_CODE/g, "ZRA")
    // The hourly message for the 10AM hour is dispatched just after 11:00.
    .replace(/\bHH:MM\b/g, hourly ? "11:03" : "13:40")
    .replace(/\(XX00 to XX00\)/g, "(1000 to 1100)")
    .replace(/\bXX(\d\d)\b/g, "10$1");
}

const lines = readFileSync(DOC, "utf8").split("\n");

const starts = [];
lines.forEach((line, index) => {
  const match = KEYED_HEADER.exec(line);
  if (match) starts.push({ index, column: match[1], value: match[2] });
});
if (!starts.length) throw new Error(`No \`column = value\` sections found in ${DOC}`);

/** The blank-column fallback per formatter column, from the doc's own table. */
const fallbacks = {};
for (const line of lines) {
  const row = /^\|\s*`([a-z0-9_]+)`\s*\|[^|]*\|\s*`([A-Za-z0-9_]+)`\s*\|\s*$/.exec(line);
  if (row) fallbacks[row[1]] = row[2];
}

const previews = starts.map((start, n) => {
  // Close at the next h2 of ANY form, not just the next keyed one.
  let end = lines.length;
  for (let i = start.index + 1; i < lines.length; i += 1) {
    if (ANY_HEADER.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start.index + 1, end);

  // Preferred: the one-line intent summary. Sections written before the intent
  // blocks were added fall back to their first prose paragraph.
  const intent = body.find((line) => line.startsWith("**What it is.**"));
  let summary = intent ? intent.replace("**What it is.**", "").trim() : "";
  if (!summary) {
    const prose = [];
    for (const line of body) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (prose.length) break;
        continue;
      }
      if (trimmed.startsWith("#") || trimmed.startsWith("```") || trimmed.startsWith("<!--")) break;
      prose.push(trimmed);
    }
    summary = prose.join(" ");
  }
  if (!summary) throw new Error(`No summary found for ${start.column} = ${start.value}`);

  // Every fenced block, captioned by the nearest preceding line ending in ":".
  const bubbles = [];
  const seen = new Set();
  let caption = null;
  for (let i = 0; i < body.length; i += 1) {
    if (/^```/.test(body[i])) {
      const buffer = [];
      i += 1;
      while (i < body.length && !/^```/.test(body[i])) {
        buffer.push(body[i]);
        i += 1;
      }
      const text = substitute(buffer.join("\n").trim());
      if (text && !seen.has(text)) {
        seen.add(text);
        bubbles.push({ caption: caption && caption !== "Shape" ? caption : null, text });
      }
      caption = null;
      continue;
    }
    const trimmed = body[i].trim();
    if (trimmed.endsWith(":") && !trimmed.startsWith("-") && !trimmed.startsWith("|") && trimmed.length < 90) {
      caption = trimmed.replace(/:$/, "");
    }
  }
  if (!bubbles.length) throw new Error(`No example blocks found for ${start.column} = ${start.value}`);

  return {
    service: "noise",
    column: start.column,
    value: start.value,
    summary,
    kind: "message",
    bubbles,
    isFallback: fallbacks[start.column] === start.value,
    source: `noise MESSAGE_SHAPES.md §${n + 1}`,
  };
});

const banner = `// GENERATED FILE — do not edit by hand.
//
// Produced by scripts/build-message-previews.mjs from the noise repo's
// MESSAGE_SHAPES.md, so the examples shown in HALO are the ones that repo
// documents rather than a second, drifting copy. Regenerate after the noise
// message shapes change:
//
//     node scripts/build-message-previews.mjs
//
// Run-time placeholders (PROJECT_CODE, HH:MM, XXnn) are filled with the same
// concrete values the source doc's own "real example" blocks use.

import type { FormatterPreview } from "./message-previews";

export const NOISE_PREVIEWS: FormatterPreview[] = ${JSON.stringify(previews, null, 2)};
`;

writeFileSync(OUT, banner);
console.log(`Wrote ${previews.length} previews to ${OUT}`);
for (const preview of previews) {
  console.log(
    `  ${preview.column} = ${preview.value}  (${preview.bubbles.length} example${preview.bubbles.length === 1 ? "" : "s"}${preview.isFallback ? ", blank-column default" : ""})`,
  );
}
