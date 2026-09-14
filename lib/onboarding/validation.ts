import { withinServiceArea } from "../derive";
import { readSheetId } from "../jobs";
import { rowProblems } from "../row-rules";
import type { ProjectConfigRow } from "../services";
import { resolveValue } from "./values";
import type { OnboardDefinition, OnboardDraft } from "./types";

/**
 * Everything wrong with a draft, rather than the first thing — one round trip
 * should tell someone the whole list.
 */
export function validateDraft(
  definition: OnboardDefinition,
  draft: OnboardDraft,
  existing: ProjectConfigRow[],
  /**
   * Env-backed defaults, so a required field with a server default does not read
   * as missing. The browser cannot see `process.env`, so it passes a stub built
   * from GET /api/onboard/<service> — presence is all this needs, never the value.
   */
  env: Record<string, string | undefined> = {},
): string[] {
  const problems: string[] = [];
  const value = (column: string) => String(draft[column] ?? "").trim();

  const code = value("project_code");
  if (!code) {
    problems.push("Project code is required.");
  } else if (!definition.codePattern.test(code)) {
    problems.push(`Project code is not valid for ${definition.service}: ${definition.codeHelp}`);
  } else if (existing.some((row) => String(row.project_code ?? "").toLowerCase() === code.toLowerCase())) {
    problems.push(`${code} already exists.`);
  }

  /**
   * A draft key that is not a field of this service.
   *
   * Reported rather than ignored. `buildInsertRow` iterates the FIELDS, so an
   * unknown key was silently dropped and the row came back looking created —
   * the same shape as the bug where a sheet endpoint accepted `project_code`
   * in its body and quietly ignored it, and every caller looked fine for
   * weeks. Now that the field list is the whole table, a key that matches
   * nothing is a typo or a stale column name, and naming it is the only useful
   * answer.
   */
  const known = new Set(definition.fields.map((field) => field.column));
  for (const key of Object.keys(draft)) {
    if (!known.has(key)) problems.push(`"${key}" is not a column of this service.`);
  }

  for (const field of definition.fields) {
    if (field.column === "project_code") continue;
    const resolved = resolveValue(field, draft, code, env).trim();
    if (field.required && !resolved) {
      problems.push(`${field.label} is required.`);
      continue;
    }
    if (resolved && field.kind === "select" && field.options && !field.options.includes(resolved)) {
      problems.push(`${field.label}: "${resolved}" is not one of ${field.options.join(", ")}.`);
    }
    if (resolved && field.kind === "toggle" && resolved !== "true" && resolved !== "false") {
      problems.push(`${field.label} must be true or false.`);
    }
    if (resolved && field.kind === "hhmm" && !/^([01][0-9]|2[0-3])[0-5][0-9]$/.test(resolved)) {
      problems.push(`${field.label} must be a 24-hour HHMM time, e.g. 0800.`);
    }
    if (resolved && field.kind === "multi" && field.options) {
      const bad = resolved
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((entry) => !field.options!.includes(entry));
      if (bad.length) {
        problems.push(`${field.label}: ${bad.join(", ")} — allowed values are ${field.options.join(", ")}.`);
      }
    }
    // A sheet id Postgres would happily store but Google would reject. Caught
    // here because the failure is otherwise a cron-time Sheets error on a
    // project nobody is watching yet.
    if (resolved && field.kind === "sheet" && !readSheetId(resolved)) {
      problems.push(
        `${field.label} does not look like a Google Sheet id. Paste the sheet's URL, or the id from it — the long string between /d/ and /edit.`,
      );
    }
    // Range checks mirror the column CHECKs, so a value Postgres would reject is
    // caught here rather than surfacing as a constraint violation.
    if (resolved && field.kind === "number") {
      const value = Number(resolved);
      if (!Number.isFinite(value)) {
        problems.push(`${field.label} must be a number.`);
      } else if (field.range && (value < field.range.min || value > field.range.max)) {
        problems.push(`${field.label} must be between ${field.range.min} and ${field.range.max}.`);
      }
    }
  }

  // The working-hours window is both-or-neither in the database, and one end
  // alone is silently treated as no window at all by the services. Caught here
  // so the dialog does not offer a half-window that looks like a restriction.
  const start = value("working_hours_start_hhmm");
  const end = value("working_hours_end_hhmm");
  if (definition.fields.some((field) => field.column === "working_hours_start_hhmm")) {
    if (Boolean(start) !== Boolean(end)) {
      problems.push("Working hours need both ends, or neither — one alone means no window at all.");
    } else if (start && start === end) {
      problems.push("Working hours cannot start and end at the same time.");
    }
  }

  // Coordinates are checked as a pair: one alone cannot be inside the service
  // area, and the CHECK constraints reject the row rather than the field.
  const hasCoords = definition.fields.some((field) => field.column === "latitude");
  if (hasCoords) {
    const lat = Number(value("latitude"));
    const lon = Number(value("longitude"));
    if (value("latitude") && value("longitude") && !withinServiceArea(lat, lon)) {
      problems.push("Latitude and longitude must fall inside Singapore — 1.10 to 1.50, 103.55 to 104.15.");
    }
  }

  /**
   * The multi-column CHECKs, from the same file the editor reads.
   *
   * A draft is a row with `enabled` false, so the rules apply unchanged — and
   * stating them here means the dialog and a chat proposal refuse a
   * combination with the same sentence the editor would use, instead of
   * letting Postgres answer with a constraint name.
   */
  for (const problem of rowProblems(
    definition.service,
    { ...draft, enabled: false },
    (column) => definition.fields.find((field) => field.column === column)?.label ?? column,
    "creating",
  )) {
    problems.push(problem.message);
  }

  // Pre-empt the composite unique key rather than surfacing a Postgres error.
  if (definition.uniqueTogether?.length) {
    const pair = definition.uniqueTogether.map((column) => value(column));
    const clash = existing.find((row) =>
      definition.uniqueTogether!.every(
        (column, index) => String(row[column] ?? "").trim() === pair[index],
      ),
    );
    if (clash) {
      const blank = pair.every((entry) => entry === "");
      problems.push(
        blank
          ? `${String(clash.project_code)} is already a draft with both ${definition.uniqueTogether.join(" and ")} blank. Postgres allows only one — fill one of them in, or finish ${String(clash.project_code)} first.`
          : `${String(clash.project_code)} already uses that ${definition.uniqueTogether.join(" + ")} pair.`,
      );
    }
  }

  return problems;
}
