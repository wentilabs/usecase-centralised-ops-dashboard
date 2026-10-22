import { ENDPOINT_SAMPLES } from "./endpoint-samples.generated";
import {
  ENDPOINT_PREVIEWS,
  type EndpointPreview,
  type SwitchRule,
} from "./endpoint-registry";
import { previewContext, previewsFor, type PreviewBubble } from "./message-previews";
import type { ProjectConfigRow, ServiceKey } from "./services";

export { DIAGNOSTICS_THAT_SEND, ENDPOINT_PREVIEWS, HELP_COLUMNS, NOT_A_MESSAGE, QUIET_KINDS } from "./endpoint-registry";
export type { EndpointPreview, EndpointSource, SwitchRule } from "./endpoint-registry";

/**
 * Reading the registry: which messages an endpoint can send, and who receives them.
 * The data itself is in `endpoint-registry.ts`, kept free of imports from
 * `message-previews.ts` so that file can build the `?` entries from it.
 */

export function endpointPreviewsFor(service: ServiceKey): EndpointPreview[] {
  return ENDPOINT_PREVIEWS.filter((entry) => entry.service === service);
}

export type EndpointVariant = {
  /** Which option or situation this is; empty when the source has only one message. */
  label: string;
  /** What distinguishes it from its siblings, when the source gave a sentence. */
  summary: string | null;
  isFallback: boolean;
  bubbles: PreviewBubble[];
  /** The text every sibling shares, when the source says so. */
  intro: string | null;
  /** Where the text came from. */
  source: string;
  /** The config column this variant belongs to, when it is a formatter option. */
  column: string | null;
};

/** Every distinct message this endpoint can send, in the order the sources list them. */
export function variantsOf(entry: EndpointPreview): EndpointVariant[] {
  const out: EndpointVariant[] = [];
  for (const source of entry.sources) {
    if ("sample" in source) {
      const sample = ENDPOINT_SAMPLES[source.sample];
      if (!sample) throw new Error(`No generated sample named ${source.sample}`);
      out.push({ label: "", summary: null, isFallback: false, bubbles: sample.bubbles, intro: null, source: sample.source, column: null });
      continue;
    }
    const intro = previewContext(entry.service, source.column)?.intro ?? null;
    for (const option of previewsFor(entry.service, source.column)) {
      const bare = option.value === "true" || option.value === "false";
      out.push({
        label: bare ? `${source.column} = ${option.value}` : option.value,
        summary: option.summary,
        isFallback: option.isFallback === true,
        bubbles: option.kind === "cadence"
          ? previewContext(entry.service, source.column)?.shared ?? []
          : option.bubbles,
        intro,
        source: option.source,
        column: source.column,
      });
    }
  }
  return out;
}

function isOn(rule: SwitchRule, row: ProjectConfigRow): boolean {
  const value = row[rule.column];
  if (rule.as === "flag") return value === true;
  if (Array.isArray(value)) return value.some((item) => String(item ?? "").trim());
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Whether this project would receive the endpoint's message: the project's own
 * `enabled` and every switch the endpoint lists. It is the configuration's answer, not
 * an observation — a project that is on can still be skipped on a given run by a
 * calendar or time gate, which the service decides at run time.
 */
export function receivesEndpoint(entry: EndpointPreview, row: ProjectConfigRow): boolean {
  if (entry.enabledBy === null) return false;
  return row.enabled === true && entry.enabledBy.every((rule) => isOn(rule, row));
}

export function projectsReceiving(entry: EndpointPreview, rows: ProjectConfigRow[]): string[] {
  return rows
    .filter((row) => receivesEndpoint(entry, row))
    .map((row) => String(row.project_code ?? "").trim())
    .filter(Boolean)
    .sort();
}
