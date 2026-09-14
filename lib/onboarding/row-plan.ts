import { resolveValue } from "./values";
import type { OnboardDefinition, OnboardDraft } from "./types";

export function buildInsertRow(
  definition: OnboardDefinition,
  draft: OnboardDraft,
  env: Record<string, string | undefined> = {},
): Record<string, unknown> {
  const code = String(draft.project_code ?? "").trim();
  const row: Record<string, unknown> = { enabled: false };
  for (const field of definition.fields) {
    if (field.target === "companion") continue;
    const value = resolveValue(field, draft, code, env);
    // A schema field nobody filled in is left out of the insert entirely, so
    // the column's own default applies. Writing null instead would replace a
    // considered default with a blank, and fail outright on the NOT NULL ones.
    if (field.fromSchema && !value) continue;
    if (field.kind === "toggle") {
      // A boolean column, so write a boolean. "false" as a string is truthy in
      // enough places that sending it would be asking for trouble.
      row[field.column] = value === "true";
      continue;
    }
    if (field.kind === "multi") {
      // An empty list stays an empty array rather than "" or null, so a
      // cardinality CHECK reports the real reason instead of a type error.
      row[field.column] = value
        ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
        : [];
      continue;
    }
    row[field.column] = value ? value : field.notNull ? "" : null;
  }
  return row;
}
