import type { FieldSpec } from "./field-spec";

/**
 * Coerce a value from the browser into what Postgres expects, rejecting
 * anything the live schema cannot accept. Pure, so it is unit-tested.
 */
export function coerceValue(field: FieldSpec, raw: unknown): unknown {
  // Postgres array columns (e.g. lightning strike types). Empty stays an empty
  // array so a NOT NULL / cardinality CHECK reports the real reason.
  if (field.type === "array" || field.widget === "multi") {
    const arr = Array.isArray(raw)
      ? (raw as unknown[]).map(String)
      : String(raw ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    if (field.options) {
      for (const v of arr) {
        if (!field.options.includes(v)) {
          throw new Error(`${field.name}: "${v}" is not one of ${field.options.join(", ")}`);
        }
      }
    }
    return arr;
  }

  if (raw === null || raw === undefined || raw === "") return null;

  if (field.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    throw new Error(`${field.name}: expected true/false`);
  }

  if (field.type === "integer" || field.type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${field.name}: expected a number`);
    if (field.type === "integer" && !Number.isInteger(n)) {
      throw new Error(`${field.name}: expected a whole number`);
    }
    return n;
  }

  const s = String(raw).trim();
  if (field.options && !field.options.includes(s)) {
    throw new Error(`${field.name}: "${s}" is not one of ${field.options.join(", ")}`);
  }
  if (field.widget === "hhmm" && !/^\d{4}$/.test(s)) {
    throw new Error(`${field.name}: expected HHMM, e.g. 0730`);
  }
  return s;
}

export type ValidatedPatch = {
  patch: Record<string, unknown>;
  rejected: string[];
};

/** Validate a whole change-set against the field spec before touching the DB. */
export function validateChanges(
  fields: Record<string, FieldSpec>,
  changes: Record<string, unknown>,
): ValidatedPatch {
  const patch: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [name, raw] of Object.entries(changes)) {
    const field = fields[name];
    if (!field) {
      rejected.push(`${name}: unknown column`);
      continue;
    }
    if (field.readonly) {
      rejected.push(`${name}: read-only`);
      continue;
    }
    try {
      patch[name] = coerceValue(field, raw);
    } catch (error) {
      rejected.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { patch, rejected };
}

/** Drop no-ops so the audit trail only records real transitions. */
export function effectiveChanges(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(patch)) {
    if (JSON.stringify(before[name] ?? null) !== JSON.stringify(value ?? null)) out[name] = value;
  }
  return out;
}
