import type { ServiceKey } from "./services";
import { contractFieldFor, contractOptionsFor, contractReadonlyFields } from "./service-contracts";
import { FIELD_PROVIDERS } from "./field-spec/providers";
import type {
  FieldGroup,
  FieldSpec,
  FieldWidget,
  IntrospectedColumn,
  ServiceFieldSpec,
} from "./field-spec/types";

export type {
  FieldGroup,
  FieldSpec,
  FieldWidget,
  IntrospectedColumn,
  ServiceFieldSpec,
  ShowIf,
} from "./field-spec/types";
export { COMPANIES } from "./field-spec/types";
export { JOB_STATE_COLUMNS, auditChangesWithoutJobState } from "./job-state-policy";

/**
 * Compatibility views used by coverage tests and existing UI callers. New
 * service semantics belong in exactly one provider under field-spec/providers.
 */
export const FIELDS: Record<string, Record<string, Partial<FieldSpec>>> = Object.fromEntries(
  Object.entries(FIELD_PROVIDERS).map(([service, provider]) => [service, provider.fields]),
);
export const GROUPS: Record<string, FieldGroup[]> = Object.fromEntries(
  Object.entries(FIELD_PROVIDERS).map(([service, provider]) => [service, provider.groups]),
);

// Merge live physical columns with a service-owned semantic overlay. Unknown
// columns remain visible under Other so contract metadata never displaces
// introspection as the schema source of truth.
export function buildFieldSpec(
  usecase: ServiceKey | string,
  introspected: Record<string, IntrospectedColumn>,
): ServiceFieldSpec {
  const provider = FIELD_PROVIDERS[usecase];
  const readonly = new Set([...(provider?.readonlyFields || []), ...contractReadonlyFields(usecase)]);
  const checkEnums = { ...contractOptionsFor(usecase), ...(provider?.checkEnums || {}) };
  const hints = provider?.fields || {};
  const groups = provider?.groups || [];

  const fields: Record<string, FieldSpec> = {};
  for (const [name, col] of Object.entries(introspected)) {
    const hint = hints[name] || {};
    const contractHint = contractFieldFor(usecase, name);
    const options = col.enum || checkEnums[name] || null;
    let widget: FieldWidget | undefined = hint.widget;
    if (!widget) {
      if (col.type === "boolean") widget = "toggle";
      else if (options) widget = "select";
      else if (col.type === "integer" || col.type === "number") widget = "number";
      else widget = "text";
    }
    fields[name] = {
      name,
      label: hint.label || contractHint?.label || name,
      help: hint.help || contractHint?.help || "",
      type: col.type,
      widget,
      options,
      default: col.default ?? null,
      readonly: readonly.has(name),
      hidden: Boolean(hint.hidden),
      showIf: hint.showIf || null,
      row: hint.row || null,
    };
  }

  const visible = (field: string) => fields[field] && !fields[field].hidden;
  const claimed = new Set<string>();
  const rendered: FieldGroup[] = [];
  for (const group of groups) {
    const present = group.fields.filter(visible);
    group.fields.forEach((field) => claimed.add(field));
    if (present.length) rendered.push({ title: group.title, fields: present });
  }
  const leftovers = Object.keys(fields).filter((field) => !claimed.has(field) && visible(field)).sort();
  if (leftovers.length) rendered.push({ title: "Other", fields: leftovers });

  return { fields, groups: rendered };
}
