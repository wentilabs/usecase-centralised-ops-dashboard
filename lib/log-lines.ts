/**
 * Whatever a service wrote about a failure, as a list of readable lines.
 *
 * The five tables disagree about the shape. `wbgt_job_runs.errors` and
 * `noise_job_runs.errors` are arrays of sentences, one per affected sensor;
 * Haze's `last_error`, Lightning's `last_delivery_error` and Chaser's `error`
 * are single strings. Some are null on a row that still failed, because not
 * every service records a reason.
 *
 * Normalised here rather than in each reader so the modal can render one shape,
 * and kept as a LIST rather than joined, because an array entry is already one
 * finding and joining them would read as a single run-on error.
 */
export function logLines(value: unknown): string[] {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry) => logLines(entry));
  }

  if (typeof value === "object") {
    // A JSON error object: shown as compact JSON rather than "[object Object]",
    // which is what a naive String() would put in front of a reader.
    try {
      return [JSON.stringify(value)];
    } catch {
      return [];
    }
  }

  const text = String(value).trim();
  return text ? [text] : [];
}
