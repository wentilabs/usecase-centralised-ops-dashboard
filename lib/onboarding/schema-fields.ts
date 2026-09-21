import type { FieldWidget, ServiceFieldSpec } from "../field-spec";
import type { OnboardDefinition, OnboardField, OnboardFieldKind } from "./types";

/**
 * Every column the editor would let you change, whether or not this file names it.
 *
 * The rule, and the whole point of this function: **anything editable after a
 * row is created is settable while creating it.** The curated `fields` list
 * below is what somebody thought about — required-ness, env defaults, derived
 * tab names, the coordinate picker, the group picker — and it is deliberately
 * short. It was also, silently, the entire vocabulary of the create path: a
 * column absent from it could not be typed into the dialog, could not be sent
 * to `createProject`, and could not be named by the model in a proposal. The
 * only way to set one was to create the row and immediately edit it, which is
 * two audit rows and a window where the row is wrong.
 *
 * So the live schema supplies the rest. Order is curated first, schema after,
 * because the curated fields are the ones that decide whether the insert is
 * accepted at all. Read-only columns are excluded for the same reason the
 * editor excludes them — identity and audit stamps — and hidden ones because
 * they are job state the services write and nobody sets by hand.
 *
 * `enabled` is excluded on purpose and is not an oversight: every service's own
 * docs prescribe insert-disabled-then-verify, and issue-chaser's
 * `issue_chaser_feature_requires_enabled_check` is one of several constraints
 * written on that assumption. Turning a project on is a separate, deliberate
 * act on a row that exists.
 *
 * Pass a null spec — introspection failed, or a caller has none — and the
 * curated definition is returned unchanged, so the create path degrades to
 * what it did before rather than breaking.
 */
export function withSchemaFields(
  definition: OnboardDefinition,
  spec: ServiceFieldSpec | null | undefined,
): OnboardDefinition {
  if (!spec) return definition;
  const named = new Set(definition.fields.map((field) => field.column));
  const extra: OnboardField[] = [];
  for (const column of Object.keys(spec.fields)) {
    const field = spec.fields[column];
    if (named.has(column) || field.readonly || field.hidden || column === "enabled") continue;
    extra.push({
      column,
      label: field.label,
      help: field.help || undefined,
      kind: kindForWidget(field.widget),
      // Nothing here is required: the curated list carries every field the
      // insert genuinely cannot do without, and a column with a NOT NULL and a
      // default is satisfied by leaving it out.
      required: false,
      notNull: false,
      options: field.options ?? undefined,
      fromSchema: true,
      schemaDefault:
        field.default === null || field.default === undefined ? undefined : String(field.default),
    });
  }
  return extra.length ? { ...definition, fields: [...definition.fields, ...extra] } : definition;
}
/**
 * The editor's widget vocabulary in the dialog's terms.
 *
 * `csv` and `meters` become plain text: both are comma lists in a text column,
 * and the pickers that make them pleasant need data this form does not have.
 * They are still typeable, which is the difference that matters.
 */
function kindForWidget(widget: FieldWidget): OnboardFieldKind {
  switch (widget) {
    case "toggle":
    case "select":
    case "number":
    case "hhmm":
    case "sheet":
    case "groups":
    case "multi":
      return widget;
    case "csv":
    case "meters":
    case "sensor-groups":
    case "text":
      return "text";
  }
}
