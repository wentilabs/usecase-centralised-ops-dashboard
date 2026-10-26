import type { ServiceKey } from "./services";
import { NOISE_PREVIEWS } from "./message-previews.generated";

/**
 * What each formatter option actually sends to WhatsApp.
 *
 * A formatter column is a dropdown of opaque names — `date_loc_name_12h_complete_list`
 * tells you nothing about the message it produces, so picking the right one meant
 * reading a service repo's MESSAGE_SHAPES.md. These previews put the real message
 * next to the name.
 *
 * Provenance matters more than convenience here: a wrong example is worse than no
 * example, because it would be trusted. So nothing below is written from memory.
 *
 *  - **noise** — lifted verbatim from the noise repo's own `MESSAGE_SHAPES.md` by
 *    `scripts/build-message-previews.mjs`. See message-previews.generated.ts.
 *  - **wbgt** and **haze** — produced by *executing* those repos' message builders
 *    (`buildFiveMinAlertMessage`, `buildHazeMessage`) and pasting the output. Their
 *    docs are organised by reading band rather than by formatter value, so there was
 *    no per-formatter section to lift.
 *
 * Regenerate the noise half with `node scripts/build-message-previews.mjs`.
 */

export type PreviewBubble = {
  /** Shown above the bubble when the source labelled it, e.g. "Exceeded example". */
  caption: string | null;
  text: string;
};

export type FormatterPreview = {
  service: ServiceKey;
  column: string;
  /** The stored column value this preview describes. */
  value: string;
  /** One line: what this option does differently from its siblings. */
  summary: string;
  /**
   * `message` — this option changes the text that is sent.
   * `cadence` — the text is byte-identical to its siblings and only the firing
   * times differ. Rendering a bubble alone for those would imply a difference
   * that is not there, so they carry a `cadence` table instead.
   */
  kind: "message" | "cadence";
  bubbles: PreviewBubble[];
  cadence?: { when: string; fires: string }[];
  /** True when a blank column resolves to this option. */
  isFallback?: boolean;
  source: string;
};

/** Per-column framing, for the cases where the options alone do not explain themselves. */
export type PreviewContext = {
  intro?: string;
  /** A message body every option for this column shares. */
  shared?: PreviewBubble[];
};

const WBGT_FULL_MODERATE = `🟠 *WBGT Reading:* 32.4°C (32°C to <33°C)
*Heat Stress Level:* Moderate

*Health Advisory:*
1) Provide cool or cold drinking water supply work areas.
2) Rehydrate at least hourly. (Recommended intake of 300ml per hour).
3) Provide hourly rest breaks of a minimum of 10 minutes for heavy physical works activity.
4) Monitor WBGT every hourly.
5) Implement Buddy system; workers to look out for each other for sign of heat related illnesses.

_ZRB — Updated at: 22-Aug-2026 14:35_`;

/**
 * The two hourly wordings, straight out of `buildWbgtMessage`. Rendered without a
 * `site_name` so the footer is identical and the advisory list is the only thing
 * that differs between them — which is the whole point of the comparison.
 */
const WBGT_WOHHUP_HIGH = `🔴 *WBGT Reading:* 33.5°C (33°C and above)
*Heat Stress Level:* High

*Health Advisory:*
1) Provide cool or cold drinking water supply work areas.
2) Rehydrate at least hourly. (Recommended intake of 300ml per hour).
3) Provide hourly rest breaks of a minimum of 15 minutes for heavy physical works activity.
4) Ensure workers get adequate rest under shade for recovery from heat.
5) Rest area to be near work areas, where feasible.
6) Monitor WBGT every hourly.
7) Reschedule outdoor physical work to cooler parts of the day.
8) Close monitoring of workers health condition, particularly for vulnerable workers.
9) Implement Buddy system; workers to look out for each other for sign of heat related illnesses.
10) Longer rest periods recommended as WBGT increase.

_Updated at: 24-Aug-2026 11:35_`;

const WBGT_WOHHUP_LOW = `🟢 *WBGT Reading:* 28.0°C (Below 31°C)
*Heat Stress Level:* Low

*Health Advisory:*
1) Rehydrate regularly.
2) Provide cool or cold drinking water supply work areas.
3) Ensure workers get adequate rest under shade for recovery from heat.
4) Rest area to be near work areas, where feasible.
5) Monitor WBGT every hourly.
6) Identify workers vulnerable for heat stress.

_Updated at: 24-Aug-2026 11:35_`;

const WBGT_PENTA_HIGH = `🔴 *WBGT Reading:* 33.5°C (33°C and above)
*Heat Stress Level:* High

*Health Advisory:*
1) Provide cool drinking water and rehydrate at least hourly.
2) Stop or reschedule strenuous outdoor work and provide frequent shade/rest breaks.
3) Closely monitor workers, especially those vulnerable to heat stress, using buddy checks.

_Updated at: 24-Aug-2026 11:35_`;

const WBGT_PENTA_LOW = `🟢 *WBGT Reading:* 28.0°C (Below 31°C)
*Heat Stress Level:* Low

*Health Advisory:*
1) Provide cool drinking water.
2) Provide shade and regular rest breaks.

_Updated at: 24-Aug-2026 11:35_`;

const WBGT_PREVIEWS: FormatterPreview[] = [
  {
    service: "wbgt",
    column: "hourly_message_formatter",
    value: "wohhup_full",
    summary:
      "The full MOM advisory for the band — every point, which runs to ten at 🔴 High and six at 🟢 Low.",
    kind: "message",
    isFallback: true,
    bubbles: [
      { caption: "🔴 High — ten points", text: WBGT_WOHHUP_HIGH },
      { caption: "🟢 Low — six points", text: WBGT_WOHHUP_LOW },
    ],
    source: "wbgt lib/wbgt-thresholds.js — buildWbgtMessage (wohhup_full)",
  },
  {
    service: "wbgt",
    column: "hourly_message_formatter",
    value: "pentaocean_full",
    summary:
      "Same emoji, reading header, heat-stress level and footer — the advisory is cut to one to three actionable points.",
    kind: "message",
    bubbles: [
      { caption: "🔴 High — three points", text: WBGT_PENTA_HIGH },
      { caption: "🟢 Low — two points", text: WBGT_PENTA_LOW },
    ],
    source: "wbgt lib/wbgt-thresholds.js — buildWbgtMessage (pentaocean_full)",
  },
  {
    service: "wbgt",
    column: "five_min_alert_formatter",
    value: "short",
    summary:
      "One line per crossing — sensor, threshold and the current reading. No advisory body, no footer.",
    kind: "message",
    isFallback: true,
    bubbles: [
      {
        caption: "Crossing up through 32°C",
        text: "🟠 WBGT Alert: WBGT ZRB (WC-20) is at or above the threshold of 32°C. Current WBGT: 32.4°C",
      },
      {
        caption: "Crossing up through 33°C",
        text: "🔴 WBGT Alert: WBGT ZRB (WC-20) is at or above the threshold of 33°C. Current WBGT: 33.4°C",
      },
      {
        caption: "Recovering below 31°C",
        text: "🟢 WBGT Alert: WBGT ZRB (WC-20) has dropped below 31°C. Current WBGT: 30.8°C",
      },
    ],
    source: "wbgt lib/wbgt-five-min-alerts.js — buildWbgtExceedanceMessage",
  },
  {
    service: "wbgt",
    column: "five_min_alert_formatter",
    value: "full",
    summary:
      "The same trigger sends the full hourly advisory instead. Which wording it uses is not set here — it follows the project's Hourly wording, so the two bodies below are the same crossing on the two settings.",
    kind: "message",
    bubbles: [
      { caption: "Crossing up through 32°C — Hourly wording wohhup_full", text: WBGT_FULL_MODERATE },
      {
        caption: "Crossing up through 33°C — Hourly wording wohhup_full",
        text: `🔴 *WBGT Reading:* 33.4°C (33°C and above)
*Heat Stress Level:* High

*Health Advisory:*
1) Provide cool or cold drinking water supply work areas.
2) Rehydrate at least hourly. (Recommended intake of 300ml per hour).
3) Provide hourly rest breaks of a minimum of 15 minutes for heavy physical works activity.
4) Ensure workers get adequate rest under shade for recovery from heat.
5) Rest area to be near work areas, where feasible.
6) Monitor WBGT every hourly.
7) Reschedule outdoor physical work to cooler parts of the day.
8) Close monitoring of workers health condition, particularly for vulnerable workers.
9) Implement Buddy system; workers to look out for each other for sign of heat related illnesses.
10) Longer rest periods recommended as WBGT increase.

_ZRB — Updated at: 22-Aug-2026 14:35_`,
      },
      { caption: "Crossing up through 33°C — Hourly wording pentaocean_full", text: WBGT_PENTA_HIGH },
    ],
    source: "wbgt lib/wbgt-five-min-alerts.js — buildFiveMinAlertMessage (formatter: full, inheriting hourlyMessageFormatter)",
  },
  {
    service: "wbgt",
    column: "intermittent_reports_formatter",
    value: "red15",
    summary: "Up to three extra messages an hour: :30 from 🟡 Moderate upwards, plus :15 and :45 while 🔴 High.",
    kind: "cadence",
    isFallback: true,
    bubbles: [],
    cadence: [
      { when: ":00", fires: "Always (the hourly heartbeat, any band)" },
      { when: ":15", fires: "🔴 High only" },
      { when: ":30", fires: "🟡 Moderate, 🟠 Moderate, 🔴 High" },
      { when: ":45", fires: "🔴 High only" },
    ],
    source: "wbgt lib/wbgt-cadence.js — shouldFireForCadence",
  },
  {
    service: "wbgt",
    column: "intermittent_reports_formatter",
    value: "red30",
    summary: "One extra message an hour at most: :30, and only while 🔴 High. Quieter on moderate afternoons.",
    kind: "cadence",
    bubbles: [],
    cadence: [
      { when: ":00", fires: "Always (the hourly heartbeat, any band)" },
      { when: ":15", fires: "Never" },
      { when: ":30", fires: "🔴 High only" },
      { when: ":45", fires: "Never" },
    ],
    source: "wbgt lib/wbgt-cadence.js — shouldFireForCadence",
  },
];

const HAZE_PREVIEWS: FormatterPreview[] = [
  {
    service: "haze",
    column: "advisory_format",
    value: "default",
    summary: "One NEA health-advisory line for the band. Five bands, topping out at Hazardous above 300.",
    kind: "message",
    isFallback: true,
    bubbles: [
      {
        caption: "PSI 175 — Unhealthy",
        text: `🌫️🟡 *HAZE (ZRA) — UNHEALTHY* 🟡🌫️

*24H PSI Reading:* 175 (Unhealthy: 101–200)

*Health Advisory:* Reduce prolonged or strenuous outdoor physical exertion.

_Reading from NEA (West) 22 Aug 2026 15:19 SGT_`,
      },
      {
        caption: "PSI 320 — Hazardous",
        text: `🌫️🔴 *HAZE (ZRA) — HAZARDOUS* 🔴🌫️

*24H PSI Reading:* 320 (Hazardous: Above 300)

*Health Advisory:* Minimise outdoor activity.

_Reading from NEA (West) 22 Aug 2026 15:19 SGT_`,
      },
    ],
    source: "haze lib/haze-messages.js — buildHazeMessage (default)",
  },
  {
    service: "haze",
    column: "advisory_format",
    value: "wohhup",
    summary:
      "Wohhup's own site instructions as a bulleted list — masks, crane cabins, lifting stand-downs — and a separate Very Hazardous tier above 400.",
    kind: "message",
    bubbles: [
      {
        caption: "PSI 175 — Unhealthy",
        text: `🌫️🟡 *HAZE (ZRA) — UNHEALTHY* 🟡🌫️

*24H PSI Reading:* 175 (Unhealthy: 101–200)

*Haze health advisory*
• Employees working outdoors should wear their N95 masks.
• Tower crane cabins shall be sealed and provided with an internal circulating air conditioner to reduce the hazardous effect of haze.

_Reading from NEA (West) 22 Aug 2026 15:19 SGT_`,
      },
      {
        caption: "PSI 320 — Hazardous (note the 301–400 range, absent from the default format)",
        text: `🌫️🔴 *HAZE (ZRA) — HAZARDOUS* 🔴🌫️

*24H PSI Reading:* 320 (Hazardous: 301–400)

*Haze health advisory*
• All employees carrying out outdoor work shall wear suitable respirators.
• Susceptible employees should remain indoors and avoid strenuous work.
• Lifting team to stop all lifting activities, re-assess the risk due to poor visibility and seek site management's approval before commencement.
• Tower Crane Operators shall assess the visibility of his work area and inform the lifting supervisor on the need for stop work.

_Reading from NEA (West) 22 Aug 2026 15:19 SGT_`,
      },
    ],
    source: "haze lib/haze-messages.js — buildWohhupMessage",
  },
  {
    service: "haze",
    column: "advisory_format",
    value: "ir2",
    summary:
      "Combines the 1-hour PM2.5 advice and the 24-hour PSI Wohhup advice, using separate IR2 color bands and no forecast.",
    kind: "message",
    bubbles: [
      {
        caption: "PM2.5 55 — Band 1 green · PSI 100 — Good green",
        text: `🌫️*HAZE (IR2)* 🌫️

1H PM2.5 Reading: 55 µg/m³ (Band 1: 0–55)🟢

Haze health advisory (Based on 1H PM2.5)
• Healthy and vulnerable employees may carry out normal activities.
• Continue monitoring the haze situation.

*24H PSI Reading:* 100 (Good: 0–100)🟢

Haze health advisory (Based on 24H PSI)
• Normal activities.

_Reading from NEA (South) 24 Oct 2026 17:45 SGT_`,
      },
      {
        caption: "PM2.5 56 — Band 2 yellow · PSI 101 — Unhealthy yellow",
        text: `🌫️*HAZE (IR2)* 🌫️

1H PM2.5 Reading: 56 µg/m³ (Band 2: 56–150)🟡

Haze health advisory (Based on 1H PM2.5)
• Healthy employees should reduce strenuous outdoor activities.
• Vulnerable employees should avoid strenuous outdoor activities.
• Employees working outdoors should wear N95 masks.
• Tower crane cabins shall be sealed and provided with an internal circulating air conditioner to reduce the hazardous effect of haze.
• Employees who are not feeling well should seek medical attention.
• Hydrate and have adequate rest.

*24H PSI Reading:* 101 (Unhealthy: 101–200)🟡

Haze health advisory (Based on 24H PSI)
• Employees working outdoors should wear their N95 masks.
• Tower crane cabins shall be sealed and provided with an internal circulating air conditioner to reduce the hazardous effect of haze.

_Reading from NEA (South) 24 Oct 2026 17:45 SGT_`,
      },
      {
        caption: "PM2.5 151 — Band 3 red · PSI 201 — Very Unhealthy orange",
        text: `🌫️*HAZE (IR2)* 🌫️

1H PM2.5 Reading: 151 µg/m³ (Band 3: 151–250)🔴

Haze health advisory (Based on 1H PM2.5)
• Healthy employees should avoid strenuous outdoor activities.
• Vulnerable employees should only work indoors, preferably doing work which is not physically strenuous.
• Employees working outdoors should wear N95 masks.
• Tower crane cabins shall be sealed and provided with an internal circulating air conditioner to reduce the hazardous effect of haze.
• Employees who are not feeling well should seek medical attention.
• Hydrate and have adequate rest.

*24H PSI Reading:* 201 (Very Unhealthy: 201–300)🟠

Haze health advisory (Based on 24H PSI)
• All employees working outdoors shall wear their N95 masks.
• Susceptible employees should only work indoor, preferably doing work which is not physically strenuous.

_Reading from NEA (South) 24 Oct 2026 17:45 SGT_`,
      },
      {
        caption: "PM2.5 251 — Band 4 purple · PSI 301 — Hazardous red",
        text: `🌫️*HAZE (IR2)* 🌫️

1H PM2.5 Reading: 251 µg/m³ (Band 4: >=251)🟣

Haze health advisory (Based on 1H PM2.5)
• All employees should remain indoors and avoid strenuous work.
• Employees carrying out unavoidable outdoor work must wear N95 or equivalent masks.
• Lifting teams shall stop all lifting activities, reassess the risk due to poor visibility and seek site management approval before restarting.
• Tower crane operators shall assess visibility in their work area and inform the lifting supervisor if work needs to stop.
• Employees who are not feeling well should seek medical attention.
• Hydrate and have adequate rest.

*24H PSI Reading:* 301 (Hazardous: 301+)🔴

Haze health advisory (Based on 24H PSI)
• All employees carrying out outdoor work shall wear suitable respirators.
• Susceptible employees should remain indoors and avoid strenuous work.
• Lifting team to stop all lifting activities, re-assess the risk due to poor visibility and seek site management's approval before commencement.
• Tower Crane Operators shall assess the visibility of his work area and inform the lifting supervisor on the need for stop work.

_Reading from NEA (South) 24 Oct 2026 17:45 SGT_`,
      },
    ],
    source: "haze MESSAGE_SHAPES.md §1; usecase-haze-alerts/src/domain/haze-messages.ts — buildHazeMessage (ir2)",
  },
];

export const MESSAGE_PREVIEWS: FormatterPreview[] = [...NOISE_PREVIEWS, ...WBGT_PREVIEWS, ...HAZE_PREVIEWS];

const PREVIEW_CONTEXT: Record<string, PreviewContext> = {
  "wbgt:intermittent_reports_formatter": {
    intro:
      "Both options send the same message — this column only decides how often. The body below is the hourly WBGT advisory; the tables show which quarter-hours it repeats on.",
    shared: [{ caption: "The message body, identical for both options", text: WBGT_FULL_MODERATE }],
  },
  "wbgt:hourly_message_formatter": {
    intro:
      "This also governs the 5-minute alert whenever its own formatter is set to full — the short single-line alert is unaffected.",
  },
  "wbgt:five_min_alert_formatter": {
    intro:
      "full does not pick a wording of its own: it renders whichever Hourly wording the project is set to. Change that field to change what full sends.",
  },
  "noise:five_min_formatter": {
    intro:
      "The 5-minute cadence either stays silent until a meter breaches, or reports every cycle. Two of these options do both.",
  },
};

/** Every preview for a column, ordered so the blank-column default comes first. */
export function previewsFor(service: ServiceKey, column: string): FormatterPreview[] {
  return MESSAGE_PREVIEWS.filter(
    (preview) => preview.service === service && preview.column === column,
  ).sort((a, b) => Number(Boolean(b.isFallback)) - Number(Boolean(a.isFallback)));
}

export function previewContext(service: ServiceKey, column: string): PreviewContext | null {
  return PREVIEW_CONTEXT[`${service}:${column}`] ?? null;
}

export function hasPreview(service: ServiceKey, column: string): boolean {
  return MESSAGE_PREVIEWS.some((preview) => preview.service === service && preview.column === column);
}

/** The option a blank column resolves to, for labelling "— not set —". */
export function fallbackValue(service: ServiceKey, column: string): string | null {
  return previewsFor(service, column).find((preview) => preview.isFallback)?.value ?? null;
}
