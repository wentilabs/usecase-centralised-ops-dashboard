export type FieldWidget =
  | "toggle"
  | "select"
  | "number"
  | "text"
  | "hhmm"
  | "csv"
  | "sheet"
  | "multi"
  | "groups"
  | "meters"
  | "sensor-groups";

export type ShowIf =
  | { field: string; equals: unknown }
  | { anyOf: { field: string; equals: unknown }[] }
  | { allOf: { field: string; equals: unknown }[] };

export type FieldSpec = {
  name: string;
  label: string;
  help: string;
  type?: string;
  widget: FieldWidget;
  options: string[] | null;
  default: unknown;
  readonly: boolean;
  hidden: boolean;
  showIf: ShowIf | null;
  row: string | null;
  /**
   * The service endpoints that read this column, as `METHOD /path`.
   *
   * Carried on the field rather than looked up beside it so every consumer —
   * the editor, the create dialog, an agent reading `getSchema` — answers
   * "what does this column actually do" from the same place.
   */
  routes: string[];
  /** Whether HALO can show the real message this column produces. */
  hasPreview: boolean;
};

export type FieldGroup = { title: string; fields: string[] };

export type ServiceFieldSpec = {
  fields: Record<string, FieldSpec>;
  groups: FieldGroup[];
};

export type IntrospectedColumn = {
  type?: string;
  format?: string;
  enum?: string[] | null;
  default?: unknown;
};

export type ServiceFieldProvider = {
  readonlyFields: string[];
  checkEnums: Record<string, string[]>;
  fields: Record<string, Partial<FieldSpec>>;
  groups: FieldGroup[];
};

/**
 * Advisory values for a plain-text company column. Values outside this list
 * remain valid and visible because the database deliberately has no CHECK.
 */
export const COMPANIES = ["Wohhup", "Obayashi", "PentaOcean", "Soilbuild"] as const;
