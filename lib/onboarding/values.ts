import { readSheetId } from "../jobs";
import type { OnboardDraft, OnboardField, OnboardDefinition } from "./types";

/**
 * The value a column ends up with: what was typed, else the env default, else the
 * derived name, else the literal fallback.
 */
export function resolveValue(
  field: OnboardField,
  draft: OnboardDraft,
  projectCode: string,
  env: Record<string, string | undefined>,
): string {
  // A computed field is derived from the project code, whatever the draft says.
  if (field.computed) return field.derive && projectCode ? field.derive(draft, projectCode) : "";
  const typed = String(draft[field.column] ?? "").trim();
  if (typed) {
    // Pasting the browser's address bar is the natural gesture for a sheet
    // field, and every service wants the bare id — a stored URL fails at the
    // Sheets API, far from here. `readSheetId` is the same extraction HALO's
    // job preconditions use, so the two cannot disagree. An unparseable value
    // is returned untouched, for validateDraft to reject with a reason.
    if (field.kind === "sheet") return readSheetId(typed) ?? typed;
    return typed;
  }
  if (field.envDefault && env[field.envDefault]) return String(env[field.envDefault]).trim();
  if (field.derive && projectCode) return field.derive(draft, projectCode);
  if (field.fallback) return field.fallback;
  return "";
}
/**
 * The values the dialog should prefill, resolved server-side.
 *
 * Real values rather than "comes from an env var": someone approving a new row
 * should see the URL it will carry. These are already visible in the editor for
 * every existing project, so this exposes nothing new to an authorised session.
 */
export function prefillDefaults(
  definition: OnboardDefinition,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of definition.fields) {
    if (field.computed || field.target === "companion") continue;
    const value = field.envDefault ? (env[field.envDefault] ?? "") : (field.fallback ?? "");
    if (value) out[field.column] = String(value).trim();
  }
  return out;
}

/** Env defaults that are declared but unset, so the dialog can say so up front. */
export function missingEnvDefaults(
  definition: OnboardDefinition,
  env: Record<string, string | undefined>,
): string[] {
  return definition.fields
    .filter((field) => field.envDefault && !env[field.envDefault])
    .map((field) => field.envDefault as string);
}
