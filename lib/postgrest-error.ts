/**
 * Turning a PostgREST rejection into a sentence.
 *
 * The raw form is unusable at the moment it matters most. A CHECK violation
 * arrives as
 *
 *   400 {"code":"23514","details":"Failing row contains (TEST4, 1PnO9ig…,
 *   https://3ibx8cveia.execute-api.ap-southeast-1.amazonaws.com/prox…
 *
 * — truncated mid-URL by the caller's own 300-character cap, with the
 * `message` naming the constraint pushed off the end by a `details` nobody
 * reads. The operator sees a number and half a row and has no way to tell
 * which column was wrong. That happened on a real insert here: the plan said
 * "ready to create", the database said 23514, and neither said
 * `issue_chaser_feature_requires_enabled_check`.
 *
 * So: `message` first, the constraint name when there is one, `hint` when
 * Postgres offers it, and `details` last and clipped short — it is the one
 * field that carries the whole row and the one least likely to help.
 */
export function describePostgrestError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw ?? "");
  const start = text.indexOf("{");
  if (start < 0) return text;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text.slice(start)) as Record<string, unknown>;
  } catch {
    return text;
  }

  const status = text.slice(0, start).trim().replace(/[:\s]+$/, "");
  const say = (key: string) => {
    const value = body[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };

  const parts: string[] = [];
  const message = say("message");
  if (message) parts.push(message);
  // The constraint name is the actionable part and is often only inside the
  // message; naming it separately costs nothing and survives a clip.
  const constraint = message?.match(/constraint "([^"]+)"/)?.[1];
  if (constraint && !parts.some((part) => part.includes(constraint))) parts.push(`constraint ${constraint}`);
  const hint = say("hint");
  if (hint) parts.push(hint);
  const details = say("details");
  if (details) parts.push(details.length > 160 ? `${details.slice(0, 160)}…` : details);
  const code = say("code");
  if (!parts.length) return code ? `${status} (${code})` : text;
  return code ? `${parts.join(" — ")} [${code}]` : parts.join(" — ");
}
