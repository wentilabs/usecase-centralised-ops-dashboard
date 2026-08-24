// GENERATED FILE — do not edit by hand.
//
// Produced by scripts/build-message-previews.mjs from the noise repo's
// MESSAGE_SHAPES.md, so the examples shown in HALO are the ones that repo
// documents rather than a second, drifting copy. Regenerate after the noise
// message shapes change:
//
//     node scripts/build-message-previews.mjs
//
// Run-time placeholders (PROJECT_CODE, HH:MM, XXnn) are filled with the same
// concrete values the source doc's own "real example" blocks use.

import type { FormatterPreview } from "./message-previews";

export const NOISE_PREVIEWS: FormatterPreview[] = [
  {
    "service": "noise",
    "column": "five_min_formatter",
    "value": "exceedance_only",
    "summary": "Silent unless a meter breaches its 5-minute limit; then one consolidated alert listing every breaching meter.",
    "kind": "message",
    "bubbles": [
      {
        "caption": null,
        "text": "🔴 5 min Leq exceeded, 13:40 (ZRA)\nNM02: 91.2 dBA (limit 90)\nNM04: 92.7 dBA (limit 90)"
      }
    ],
    "isFallback": true,
    "source": "noise MESSAGE_SHAPES.md §1"
  },
  {
    "service": "noise",
    "column": "five_min_formatter",
    "value": "loc_name_exceedance_only",
    "summary": "The same breach-only alert, with each meter identified by its full location, bulleted and bolded.",
    "kind": "message",
    "bubbles": [
      {
        "caption": null,
        "text": "🔴 5 min Leq exceeded, 21:25 (P105)\n\n• *NM01 Watertown Blk 71 Punggol Central (RT):* 71.8 dBA (limit 68)\n\n• *NM03 Blk 54 Punggol Walk, Treasure Trove:* 72.4 dBA (limit 71)"
      }
    ],
    "isFallback": false,
    "source": "noise MESSAGE_SHAPES.md §2"
  },
  {
    "service": "noise",
    "column": "five_min_formatter",
    "value": "summary_with_limits",
    "summary": "A routine message every 5-minute cycle listing every meter with its reading and its limit. No separate breach alert.",
    "kind": "message",
    "bubbles": [
      {
        "caption": null,
        "text": "🕒 13:40 (ZRA)\nNM01: 63.8 dBA (limit 90) ✅\nNM02: 91.2 dBA (limit 90) 🔴\nNM03: 61.8 dBA (limit 90) ✅\nNM04: data unavailable"
      }
    ],
    "isFallback": false,
    "source": "noise MESSAGE_SHAPES.md §3"
  },
  {
    "service": "noise",
    "column": "five_min_formatter",
    "value": "summary_without_limits",
    "summary": "The same routine 5-minute list with the limit text removed, so only readings show. No separate breach alert.",
    "kind": "message",
    "bubbles": [
      {
        "caption": null,
        "text": "🕒 13:40 (ZRA)\nNM01: 68.6 dBA ✅\nNM02: 69.3 dBA ✅\nNM03: 67 dBA ✅\nNM04: 57.8 dBA ✅\nNM05: 68.7 dBA ✅\nNM06: 71.3 dBA ✅"
      }
    ],
    "isFallback": false,
    "source": "noise MESSAGE_SHAPES.md §4"
  },
  {
    "service": "noise",
    "column": "five_min_formatter",
    "value": "summary_and_exceedance",
    "summary": "Both: the routine 5-minute list with limits, and a separate consolidated alert whenever a meter breaches.",
    "kind": "message",
    "bubbles": [
      {
        "caption": null,
        "text": "🕒 13:40 (ZRA)\nNM01: 63.8 dBA (limit 90) ✅\nNM02: 91.2 dBA (limit 90) 🔴\nNM03: 61.8 dBA (limit 90) ✅\nNM04: data unavailable"
      },
      {
        "caption": "Real example shape",
        "text": "🕒 13:40 (ZRA)\nNM01: 62.4 dBA (limit 90) ✅\nNM02: 63.8 dBA (limit 90) ✅\nNM03: 61.8 dBA (limit 90) ✅\nNM04: 60.2 dBA (limit 90) ✅\nNM05: 68.6 dBA (limit 90) ✅"
      },
      {
        "caption": "Companion exceedance alert shape",
        "text": "🔴 5 min Leq exceeded, 13:40 (ZRA)\nNM02: 91.2 dBA (limit 90)\nNM04: 92.7 dBA (limit 90)"
      }
    ],
    "isFallback": false,
    "source": "noise MESSAGE_SHAPES.md §5"
  },
  {
    "service": "noise",
    "column": "half_hourly_formatter",
    "value": "estimated_Leq1hr",
    "summary": "One line per meter with the estimated Leq1hr for the hour in progress, its limit, and Reduce / Stop guidance when over.",
    "kind": "message",
    "bubbles": [
      {
        "caption": null,
        "text": "🕒 13:40 (ZRA) estimated Leq1hr\nNM01: 62.9 (67) ✅\nNM02: 69.9 (67) 🟠 - Reduce, stay below 54.7 dBA\nNM03: 78.9 (67) 🔴 - Stop, Leq1hr exceeded\nNM04: data unavailable\nNM05: 64 (NIL) ✅"
      },
      {
        "caption": "With a `Leq12hr` fallback in play",
        "text": "🕒 10:30 (ZRB) estimated Leq1hr\n_Fallback on Leq12h limit when no Leq1h limit is found_\n\nNM01: 75.9 (75 Leq12hr) 🟠 - Reduce, stay below 73.4 dBA\nNM02: 70 (75 Leq12hr) ✅"
      }
    ],
    "isFallback": true,
    "source": "noise MESSAGE_SHAPES.md §6"
  },
  {
    "service": "noise",
    "column": "half_hourly_formatter",
    "value": "all_5mins_list_Leq1hr",
    "summary": "Every 5-minute reading of the hour so far, listed per meter, followed by that meter's estimated Leq1hr.",
    "kind": "message",
    "bubbles": [
      {
        "caption": null,
        "text": "🕐 19:32 (Clifford Centre) 7PM Leq1hr (1900 to 1925)\n\n*NM01* Leq5min (7PM-10PM limit 72)\n\n1900: 72.3 dBA 🔴\n1905: 72.7 dBA 🔴\n1910: 71.7 dBA ✅\n1915: data unavailable\n1920: 71.7 dBA ✅\n1925: 73.1 dBA 🔴\n\nNM01 estimated Leq1hr: 71 dBA (72) ✅"
      },
      {
        "caption": "Exceeded example",
        "text": "🕐 19:32 (Clifford Centre) 7PM Leq1hr (1900 to 1925)\n\n*NM02* Leq5min (7PM-10PM limit 73)\n\n1900: 77.1 dBA 🔴\n1905: 79.2 dBA 🔴\n1910: 81.5 dBA 🔴\n1915: 77.3 dBA 🔴\n1920: 77.1 dBA 🔴\n1925: 76.9 dBA 🔴\n\nNM02 estimated Leq1hr: 79.1 dBA (73) 🔴, stay below 64.2"
      },
      {
        "caption": "No-limit / unavailable example",
        "text": "🕐 19:32 (ZRA) 7PM Leq1hr (1900 to 1905)\n\n*NM01* Leq5min (NIL limit)\n\n1900: data unavailable\n1905: data unavailable\n\nNM01 estimated Leq1hr: data unavailable"
      }
    ],
    "isFallback": false,
    "source": "noise MESSAGE_SHAPES.md §7"
  },
  {
    "service": "noise",
    "column": "hourly_formatter",
    "value": "12h_complete_list",
    "summary": "Per meter: every 5-minute reading of the completed hour, the Leq1hr result, and the running Leq12hr for the active 12-hour band.",
    "kind": "message",
    "bubbles": [
      {
        "caption": null,
        "text": "28-Jul-2026\n🕐 11:03 (ZRA) 10AM Leq1hr (1000 to 1100)\n\n*NM01* Leq5min (7AM-7PM limit 70)\n\n1005: 63.8 dBA ✅\n1010: 91.2 dBA 🔴\n1015: 61.8 dBA ✅\n1020: data unavailable\n1025: 63.8 dBA ✅\n\nNM01 Leq1hr: 68 dBA (limit 70) ✅\nNM01 estimated Leq12hr: 69.4 dBA (limit 75) ✅"
      },
      {
        "caption": "Completed-band example",
        "text": "28-Jul-2026\n🕐 13:40 (ZRA) 6PM Leq1hr (1800 to 1900)\n\n*NM01* Leq5min (7AM-7PM limit 90)\n\n...\n\nNM01 Leq1hr: 70.6 dBA (limit 90) ✅\nNM01 Leq12hr: 72.3 dBA (limit 75) ✅"
      }
    ],
    "isFallback": false,
    "source": "noise MESSAGE_SHAPES.md §8"
  },
  {
    "service": "noise",
    "column": "hourly_formatter",
    "value": "complete_list",
    "summary": "Per meter: every 5-minute reading of the completed hour and the Leq1hr result. No 12-hour line.",
    "kind": "message",
    "bubbles": [
      {
        "caption": null,
        "text": "28-Jul-2026\n🕐 11:03 (ZRA) 10AM Leq1hr (1000 to 1100)\n\n*NM01* Leq5min (7AM-7PM limit 70)\n\n1005: 63.8 dBA ✅\n1010: 91.2 dBA 🔴\n1015: 61.8 dBA ✅\n1020: data unavailable\n1025: 63.8 dBA ✅\n\nNM01 Leq1hr: 68 dBA (limit 70) ✅"
      }
    ],
    "isFallback": false,
    "source": "noise MESSAGE_SHAPES.md §9"
  },
  {
    "service": "noise",
    "column": "hourly_formatter",
    "value": "date_loc_name_complete_list",
    "summary": "The hourly list with a date line on top, full location names in each meter heading, and horizontal rules between meters. No 12-hour line.",
    "kind": "message",
    "bubbles": [
      {
        "caption": "Example",
        "text": "28-Jul-2026\n🕐 4:04 (CR106) 3AM Leq1hr (0300 to 0400)\n------------------------------------\n*NM01 Blk 222 Loyang Valley (Rooftop)* Leq5min (12AM-5AM limit 63)\n\n0300: 65.7 dBA 🔴\n0305: 64 dBA 🔴\n\nNM01 Leq1hr: 64.2 dBA (limit 63) 🔴\n------------------------------------\n*NM02 Blk 87 Zion Road (RT)* Leq5min (12AM-5AM limit 63)\n\n0300: 60.1 dBA ✅\n0305: 59.8 dBA ✅\n\nNM02 Leq1hr: 60 dBA (limit 63) ✅"
      }
    ],
    "isFallback": false,
    "source": "noise MESSAGE_SHAPES.md §10"
  },
  {
    "service": "noise",
    "column": "hourly_formatter",
    "value": "date_loc_name_12h_complete_list",
    "summary": "The dated, full-location, rule-separated hourly list, plus the Leq12hr line per meter.",
    "kind": "message",
    "bubbles": [
      {
        "caption": null,
        "text": "28-Jul-2026\n🕐 11:45 (MVR) 10AM Leq1hr (1000 to 1100)\n------------------------------------\n*NM01 V on Shenton (Level 8 Openings)* Leq5min (7AM-7PM limit 90)\n\n1000: 63.8 dBA ✅\n1005: 91.2 dBA 🔴\n1010: data unavailable\n\nNM01 Leq1hr: 68 dBA (limit 70) ✅\nNM01 estimated Leq12hr: 69.4 dBA (limit 75) ✅"
      }
    ],
    "isFallback": true,
    "source": "noise MESSAGE_SHAPES.md §11"
  },
  {
    "service": "noise",
    "column": "hourly_formatter",
    "value": "estimated_Leq12hr",
    "summary": "One line per meter with the Leq12hr for the active 12-hour band, its limit, and Reduce / Stop guidance when over. No 5-minute detail.",
    "kind": "message",
    "bubbles": [
      {
        "caption": null,
        "text": "28-Jul-2026\n🕒 11:03 (ZRA) 10AM estimated Leq12hr (7AM - 7PM)\nNM01: 62.9 (67) ✅ - Max allowable Leq1hr: 71.4 dBA\nNM02: 69.9 (67) 🟠 - Reduce, stay below 54.7 dBA Leq1hr\nNM03: 78.9 (67) 🔴 - Stop, Leq12hr exceeded\nNM04: data unavailable\nNM05: 64 (75) ✅"
      },
      {
        "caption": "Once the band has closed",
        "text": "28-Jul-2026\n🕒 19:03 (ZRA) 6PM Leq12hr (7AM - 7PM)\nNM01: 63.4 (67) ✅\nNM03: 78.9 (67) 🔴 - Leq12hr exceeded"
      }
    ],
    "isFallback": false,
    "source": "noise MESSAGE_SHAPES.md §12"
  },
  {
    "service": "noise",
    "column": "enable_7am_7pm_leq12hr_table",
    "value": "true",
    "summary": "This is a separate endpoint-controlled format, enabled by the boolean `noise_project_configs.enable_7am_7pm_leq12hr_table`. The external cron should invoke it hourly from `08:00` through `19:00` Singapore time. It is not selected through `hourly_formatter`.",
    "kind": "message",
    "bubbles": [
      {
        "caption": "Example at 13:04, where `0700` through `1200` have completed",
        "text": "28-Jul-2026\nHourly Leq Table (CR106) 1PM\n-----------------------------\n*NM01 Blk 222 Loyang Valley (Rooftop)* (Leq12hr 7AM-7PM limit 75 dBA)\n0700: 63.8 dBA ✅\n0800: 64.1 dBA ✅\n0900: 65.2 dBA ✅\n1000: 66 dBA ✅\n1100: 66.4 dBA ✅\n1200: 67.1 dBA ✅\n1300: -\n1400: -\n1500: -\n1600: -\n1700: -\n1800: -\n*NM01 estimated Leq12hr:* 65.7 dBA (limit 75) ✅ - Max allowable Leq1hr: 73.8 dBA"
      },
      {
        "caption": "`estimated`",
        "text": "28-Jul-2026\nHourly Leq Table (CR106) 7PM\n-----------------------------\n*NM01 Blk 222 Loyang Valley (Rooftop)* (Leq12hr 7AM-7PM limit 75 dBA)\n0700: 63.8 dBA ✅\n...\n1800: 67.1 dBA ✅\n*NM01 Leq12hr:* 65.9 dBA (limit 75) ✅"
      }
    ],
    "isFallback": false,
    "source": "noise MESSAGE_SHAPES.md §13"
  },
  {
    "service": "noise",
    "column": "three_hour_formatter",
    "value": "leq1hr_triplet_with_12hr",
    "summary": "This is a separate endpoint and cron family. It summarizes the last 3 completed hourly `Leq1hr` values for each meter, then shows the current 12-hour state for that meter.",
    "kind": "message",
    "bubbles": [
      {
        "caption": null,
        "text": "🕐 10:04 (ZRA) (0700 to 1000)\n\n*NM01*\n-7AM Leq1hr: 63.8 (70) ✅\n-8AM Leq1hr: 91.2 (70) 🔴\n-9AM Leq1hr: 63.8 (70) ✅\nEstimated Leq12hr: 69.4 dBA (75) ✅\n\n*NM02*\n-7AM Leq1hr: 63.8 (70) ✅\n-8AM Leq1hr: 91.2 (70) 🔴\n-9AM Leq1hr: 63.8 (70) ✅\nEstimated Leq12hr: 76.9 dBA (75) 🔴, stay below 73.8 Leq1hr"
      },
      {
        "caption": "Completed-band example",
        "text": "🕐 19:04 (ZRA) (1600 to 1900)\n\n*NM01*\n-4PM Leq1hr: 68.2 (70) ✅\n-5PM Leq1hr: 70.1 (70) ✅\n-6PM Leq1hr: 72.4 (70) 🔴\nLeq12hr: 74.6 dBA (75) ✅"
      }
    ],
    "isFallback": true,
    "source": "noise MESSAGE_SHAPES.md §14"
  },
  {
    "service": "noise",
    "column": "morning_formatter",
    "value": "overnight_leq1hr_summary_with_12hr",
    "summary": "This is a separate once-daily endpoint and cron family for the overnight closeout summary.",
    "kind": "message",
    "bubbles": [
      {
        "caption": "Example with `morning_summary_start_hhmm = 0000`",
        "text": "🕐 7:04 (ZRA) (0000 to 0700)\n*NM01*\n-12AM Leq1hr: 61.8 (70) ✅\n-1AM Leq1hr: 60.4 (70) ✅\n-2AM Leq1hr: 59.9 (70) ✅\n-3AM Leq1hr: 58.7 (70) ✅\n-4AM Leq1hr: 57.8 (70) ✅\n-5AM Leq1hr: 56.9 (70) ✅\n-6AM Leq1hr: 58.1 (70) ✅\n\nLeq12hr(7PM-7AM): 66.4 dBA (limit 75) ✅"
      },
      {
        "caption": "Example with `morning_summary_start_hhmm = 2200`",
        "text": "🕐 7:04 (ZRA) (2200 to 0700)\n*NM01*\n-10PM Leq1hr: 64.2 (70) ✅\n-11PM Leq1hr: 62.1 (70) ✅\n-12AM Leq1hr: 61.8 (70) ✅\n-1AM Leq1hr: 60.4 (70) ✅\n-2AM Leq1hr: 59.9 (70) ✅\n-3AM Leq1hr: 58.7 (70) ✅\n-4AM Leq1hr: 57.8 (70) ✅\n-5AM Leq1hr: 56.9 (70) ✅\n-6AM Leq1hr: 58.1 (70) ✅\n\nLeq12hr(7PM-7AM): 66.4 dBA (limit 75) ✅"
      }
    ],
    "isFallback": true,
    "source": "noise MESSAGE_SHAPES.md §15"
  },
  {
    "service": "noise",
    "column": "evening_formatter",
    "value": "daytime_leq1hr_summary_with_12hr",
    "summary": "This is a once-daily daytime closeout endpoint and cron family. It uses a fixed 07:00 start, includes every completed hourly Leq1hr from 7AM through 6PM, and ends with the completed daytime `Leq12hr(7AM-7PM)` line. Schedule it at 19:00 Singapore time; there is no separate evening summary start-time setting.",
    "kind": "message",
    "bubbles": [
      {
        "caption": "Expected message shape",
        "text": "🕐 19:04 (ZRA) (0700 to 1900)\n\n*NM01*\n-7AM Leq1hr: 64.2 (70) ✅\n-8AM Leq1hr: 63.8 (70) ✅\n...\n-6PM Leq1hr: 61.8 (70) ✅\n\nLeq12hr(7AM-7PM): 66.4 dBA (75) ✅"
      }
    ],
    "isFallback": true,
    "source": "noise MESSAGE_SHAPES.md §16"
  }
];
