/**
 * Reading a fetch response that might not have a body.
 *
 * `res.json()` throws `Unexpected end of JSON input` when the body is empty,
 * and that message describes a parser rather than anything that happened. The
 * body is empty for one reason here: the platform killed the function before it
 * answered. Amplify runs these routes on SSR compute with a fixed request
 * timeout, so a slow model call or a long sheet write hits it and the browser is
 * left holding nothing.
 *
 * Every client fetch goes through this, so that failure reads as a sentence
 * about the request instead. The jobs path additionally never asks for a long
 * request in the first place — see `chunkDays` — but the model-backed routes
 * genuinely can be slow, and an operator should be told which.
 */
export type JsonBody = Record<string, unknown> & { error?: string };

export async function readJson(res: Response): Promise<JsonBody> {
  const text = await res.text().catch(() => "");

  if (!text.trim()) {
    return {
      error: res.ok
        ? "The server answered with an empty body. The request was probably cut off before it finished; try again."
        : `The server answered ${res.status} with an empty body — the request was almost certainly cut off ` +
          "before it finished. Nothing here writes twice, so trying again is safe.",
    };
  }

  try {
    return JSON.parse(text) as JsonBody;
  } catch {
    // HTML from a proxy or gateway is the usual case. The first line is the
    // useful part; the rest is a page nobody needs in an error box.
    const firstLine = text.trim().split("\n")[0]?.slice(0, 200) ?? "";
    return { error: `The server answered ${res.status} with something that is not JSON: ${firstLine}` };
  }
}

/**
 * One line describing what a sheet job actually did.
 *
 * The services answer with their own shapes — the noise jobs wrap per-project
 * results in `{ configs_processed, results: [...] }`, WBGT reports cells — so
 * the counts worth reading are pulled out by name and everything else is left
 * alone. A log of "ok, ok, ok" would say nothing; "3 meters, 288 records" says
 * whether the run is doing work or quietly finding nothing.
 */
export function summariseJobResult(result: unknown): string {
  const counts: string[] = [];
  const errors: string[] = [];

  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 3) return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 20)) walk(item, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "errors" && Array.isArray(value)) {
        for (const entry of value.slice(0, 3)) {
          const text = typeof entry === "string" ? entry : JSON.stringify(entry);
          if (text) errors.push(text.slice(0, 160));
        }
        continue;
      }
      if (typeof value === "number" && COUNT_KEYS[key] && value > 0) {
        counts.push(`${value} ${COUNT_KEYS[key]}`);
        continue;
      }
      if (key === "status" && typeof value === "string" && value && value !== "completed") {
        counts.push(value);
        continue;
      }
      walk(value, depth + 1);
    }
  };
  walk(result, 0);

  const seen = [...new Set(counts)];
  const summary = seen.length ? seen.join(", ") : "nothing to write";
  return errors.length ? `${summary} — ${[...new Set(errors)].join("; ")}` : summary;
}

/** Count fields worth reporting, and what to call them in one line. */
const COUNT_KEYS: Record<string, string> = {
  configs_processed: "projects",
  // Added by the noise repo's 7562c33 alongside range support, so a ranged run
  // says how many days it covered rather than only that it answered.
  dates_processed: "dates",
  metersProcessed: "meters",
  records: "records",
  recordsWritten: "records",
  cellsWritten: "cells",
  cellsSkippedNoReading: "cells with no reading",
  rowsUpdated: "rows",
  sheetsCreated: "tabs created",
};
