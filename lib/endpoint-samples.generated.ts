// GENERATED FILE — do not edit by hand.
//
// Produced by scripts/build-endpoint-previews.mjs from each service's origin/main:
// fenced blocks lifted from its own message documents, and the output of its own
// message builders. Regenerate after a service's message shapes change:
//
//     node scripts/build-endpoint-previews.mjs

import type { PreviewBubble } from "./message-previews";

export const ENDPOINT_SAMPLES: Record<string, { bubbles: PreviewBubble[]; source: string }> = {
  "noise.fifteen-minute-average": {
    "bubbles": [
      {
        "caption": null,
        "text": "🔴 15 min average Leq exceeded, 19:32 (ZRA)\n\nNM01: 72.4 dBA (limit 70) (avg for last 15mins)\n\nNM04: 69.8 dBA (limit 68) (avg for last 15mins)"
      }
    ],
    "source": "noise MESSAGE_SHAPES.md, 15-minute average exceedance"
  },
  "noise.sunday-leq12hr": {
    "bubbles": [
      {
        "caption": null,
        "text": "28-Jul-2026\n🕐 10:04 (ZRA) 10AM Leq12hr (7AM - 7PM)\n\nNM01 estimated Leq12hr: 69.4 dBA (limit 75) ✅\nNM02 estimated Leq12hr: 76.1 dBA (limit 75) 🔴, stay below 73.8 Leq1hr\nNM03 estimated Leq12hr: 77.3 dBA (limit 75) 🔴 - Stop, stay below 0 Leq1hr\nNM04 estimated Leq12hr: 61.8 dBA (NIL) ✅\nNM05 estimated Leq12hr: data unavailable"
      }
    ],
    "source": "noise MESSAGE_SHAPES.md §18"
  },
  "noise.data-health": {
    "bubbles": [
      {
        "caption": null,
        "text": "🟠 CPW · Noise — Stale reading\n• CPW NM02: amber; latest 2026-10-22T04:00:00Z (4 h)"
      }
    ],
    "source": "noise MESSAGE_SHAPES.md, Data Health Reminder (placeholders filled with the values WBGT's own example uses)"
  },
  "wbgt.data-health": {
    "bubbles": [
      {
        "caption": null,
        "text": "🔴 TEST · WBGT — Stale reading\n• WBGT TEST (WC-1): red; latest 2026-09-28T07:14:00Z (4 h)"
      }
    ],
    "source": "wbgt MESSAGE_SHAPES.md, Data Health Reminders"
  },
  "wbgt.water-parade-reminder": {
    "bubbles": [
      {
        "caption": null,
        "text": "💧 Water Parade Reminder — 20 Aug 2026\nHeat stress is Moderate (12AM WBGT 31.2°C 🟡)\n\nTeams that have yet to submit a water parade photo for the hour yet:\n• XIE HE ENGINEERING Pte Ltd — @6581234567\n\nPlease post the water parade photo here as a new message with a brief caption, like \"COMPANY XXX conducted water parade\".\n\n*Or reply to this message \"not working outdoors\" to be exempted for this hour*\n\nWater Parade conducted for 12AM\n• Harmonious ✅\n• Another Company (exempted)"
      }
    ],
    "source": "wbgt docs/WATER_PARADE_INTEGRATION.md, water-parade-reminder"
  },
  "wbgt.water-parade-summary": {
    "bubbles": [
      {
        "caption": "Missed timings shown (include_missed_timings_wp = true)",
        "text": "*💧 Water Parade Summary — 16 Sept 2026 (MBS)*\nHere is the list of companies who did not conduct water parade today:\n\nTeamtech (Alice) - 0/2 (missed 2PM and 5PM)\nTeamtech (Bob) - 0/2 (missed 2PM and 5PM)\nActive Fire - 1/2 (missed 5PM)\n\n*Companies submitting their water parade more than 1 hour after the alert are counted as not having conducted it.*"
      },
      {
        "caption": "Counts only (include_missed_timings_wp = false)",
        "text": "*💧 Water Parade Summary — 16 Sept 2026 (MBS)*\nHere is the list of companies who did not conduct water parade today:\n\nTeamtech (Alice) - 0/2\nTeamtech (Bob) - 0/2\nActive Fire - 1/2\n\n*Companies submitting their water parade more than 1 hour after the alert are counted as not having conducted it.*"
      }
    ],
    "source": "wbgt usecases/water-parade/daily-summary.js buildDailySummaryMessage, run on its own test fixture"
  },
  "lightning.kickoff": {
    "bubbles": [
      {
        "caption": null,
        "text": "⚡️ Lightning detection service live and ready for the day ⚡️\n_⚙️ Source: NEA lightning detection_\nLightning notifications will begin at *0730H*\n\n━━━━━━━━━━━━━━━\nThis site stops work when lightning comes within 3.0 km, and gives a warning from 6.0 km.\nIf you SEE lightning or HEAR thunder, take shelter straight away — even if you get no message from us."
      }
    ],
    "source": "lightning MESSAGE_SHAPES.md §0"
  },
  "lightning.tick": {
    "bubbles": [
      {
        "caption": "Red — CLEAR → STOP",
        "text": "🌩🔴 STOP WORK NOW 🔴🌩\n📍 ZRA — V on Shenton\n_⚙️ Source: NEA lightning detection_\n\n🌩 Lightning is 3.5 km from site.\n\nDO THIS NOW:\n-Stop all outdoor work\n-Go inside a building or a vehicle\n-Keep away from cranes, scaffolding, metal and water\n-Wait for the green SAFE TO RESUME WORK message\n\n━━━━━━━━━━━━━━━\nGround strike detected at 3.5 km from site at 3:39 PM\nThis site stops work when lightning comes within 8.0 km.\nRule: work resumes 20 min after the last lightning within 8.0 km.\nIf you SEE lightning or HEAR thunder, take shelter straight away — even if you get no message from us."
      },
      {
        "caption": "Amber — CLEAR → WATCH (only when amber_enabled)",
        "text": "🌩️🟠 *GET READY TO SEEK LIGHTNING PROTECTED SHELTER* 🟠🌩️\n📍 ZRA — V on Shenton\n_⚙️ Source: NEA lightning detection_\n\n🌩️ Lightning is *10.5 km from site* and may come closer.\n\n*DO THIS NOW:*\n-Secure loose materials and tools\n-Make sure your team knows where the shelter is\n-Be ready to stop work quickly\n\nWork can continue for now. We will send a red message if you must stop.\n\n━━━━━━━━━━━━━━━\nCloud lightning, 10.5 km from site, 3:37 PM, 25 Aug\nThis site gives a warning when lightning comes within 12.0 km."
      },
      {
        "caption": "All-clear — STOP → CLEAR",
        "text": "🌩️🟢 *SAFE TO RESUME WORK* 🟢🌩️\n📍 ZRA — V on Shenton\n_⚙️ Source: NEA lightning detection_\n\nNo ground or cloud lightning inside the 8.0 km amber zone for the last 20 minutes.\nYou can start outdoor work again.\n\n━━━━━━━━━━━━━━━\nRule: work resumes after 20 minutes without lightning inside the amber zone.\nIf you SEE lightning or HEAR thunder, take shelter straight away — even if you get no message from us."
      },
      {
        "caption": "Degraded — the warning feed is down",
        "text": "⚪ *LIGHTNING WARNING IS DOWN* ⚪\n📍 ZRA — V on Shenton\n_⚙️ Source: NEA lightning detection_\n\nWe are not receiving lightning data right now. *We cannot warn you.*\n\n*DO THIS NOW:*\n-Watch the sky yourself\n-If you SEE lightning or HEAR thunder, stop work and take shelter\n-Wait 30 minutes after the last thunder before going back outside\n\nWe will message you when the lightning warning is working again."
      }
    ],
    "source": "lightning MESSAGE_SHAPES.md §1–§4 (renderAlert output)"
  },
  "haze.kickoff": {
    "bubbles": [
      {
        "caption": null,
        "text": "🌫️ Haze service live and started for the day 🌫️\nCurrent PSI(24H): 75 🔵 (Moderate)"
      }
    ],
    "source": "haze lib/haze-messages.js buildKickoffMessage, run on the PSI the repo's own test uses"
  },
  "subcon.manpower-summary.manpower+machine": {
    "bubbles": [
      {
        "caption": null,
        "text": "📊 *Manpower Summary — Monday, 31 August 2026*\n👷 *14* workers | 2 companies | 🚜 1 machines\n\n☀️ *Day Shift — 10 pax | 🚜 1 machines*\n · ABC Builders — 10 pax | 🚜 1\n\n🌙 *Night Shift — 4 pax*\n · XYZ Engineering — 4 pax"
      }
    ],
    "source": "subcon usecases/activity/manpower-summary.js buildManpowerSummaryMessage (manpower+machine), run on its own test fixture"
  },
  "subcon.manpower-summary.manpower-only": {
    "bubbles": [
      {
        "caption": null,
        "text": "📊 *Manpower Summary — Monday, 31 August 2026*\n👷 *14* workers | 2 companies\n\n☀️ *Day Shift — 10 pax*\n · ABC Builders — 10 pax\n\n🌙 *Night Shift — 4 pax*\n · XYZ Engineering — 4 pax"
      }
    ],
    "source": "subcon usecases/activity/manpower-summary.js buildManpowerSummaryMessage (manpower-only), run on its own test fixture"
  },
  "subcon.activity-summary": {
    "bubbles": [
      {
        "caption": null,
        "text": "*🚜👷‍♂️ Activities and Manpower for 11 August 2026*\n\nSoil excavation and soil disposal work @ B3 (KKL): 10\n\nPile head hacking, gas cutting and housekeeping @ B3 (Foundation Alliance): 10\n\nLifting works @ B2 (Recovered Co): 7\n\n*TOTAL MANPOWER: 27*"
      }
    ],
    "source": "subcon usecases/activity/summary.js buildDailySummary, run on rows from its own test/activity.test.js"
  },
  "subcon.housekeeping-report": {
    "bubbles": [
      {
        "caption": "Someone has not submitted",
        "text": "*🧹 Housekeeping Report — 2026-08-17*\n\nABC Builders ✅\nXYZ Engineering ❌ @6581234567\n\nTo submit housekeeping, submit a photo and include your company and \"housekeeping done\" in the message."
      },
      {
        "caption": "Everyone has submitted",
        "text": "*🧹 Housekeeping Report — 2026-08-17*\n\nABC Builders ✅\nXYZ Engineering ✅\n\nHousekeeping completed for the day 👏"
      },
      {
        "caption": "Everyone submitted or was excused",
        "text": "*🧹 Housekeeping Report — 2026-08-17*\n\nABC Builders ✅\nPromatrix ⚪ EXCUSED\n\nHousekeeping requirements accounted for the day 👏"
      }
    ],
    "source": "subcon usecases/housekeeping/report.js buildHousekeepingReport, run on its own test fixture"
  },
  "ailytics.status-summary": {
    "bubbles": [
      {
        "caption": null,
        "text": "🚨📸 Ailytics Safety Status (TEST) - 17 Sept 2026\n\nToday's Pending: 12\nToday's Non-Compliant: 5\n\nTotal Pending: 201\nTotal Non-Compliant: 153"
      }
    ],
    "source": "ailytics usecases/ailytics_status_summary buildStatusSummaryMessage, run on illustrative counts"
  },
  "ailytics.yesterday-summary": {
    "bubbles": [
      {
        "caption": null,
        "text": "🚨📸 Ailytics Findings Summary yesterday (TEST) - 17 Sept 2026\n\n*Total Issues Detected: 358*\n\nTotal Non-Compliant: 153\nTotal Compliant: 4\nTotal still Pending: 201"
      }
    ],
    "source": "ailytics usecases/ailytics_yesterday_summary buildYesterdaySummaryMessage, run on the counts its own test uses"
  },
  "vibration.ppv-alert": {
    "bubbles": [
      {
        "caption": "Warning · 4.0 mm/s",
        "text": "*Vibration alert · Seletar West Road-3*\n🟡 Warning\nMeter: VM01\nPPV: 4 mm/s\nApproved limit: 5 mm/s\nShare of limit: 80.0%\nReading time: 22 Oct 2026, 19:30 SGT"
      },
      {
        "caption": "Critical warning · 4.5 mm/s",
        "text": "*Vibration alert · Seletar West Road-3*\n🟠 Critical warning\nMeter: VM01\nPPV: 4.5 mm/s\nApproved limit: 5 mm/s\nShare of limit: 90.0%\nReading time: 22 Oct 2026, 19:30 SGT"
      },
      {
        "caption": "Limit reached · 5.0 mm/s",
        "text": "*Vibration alert · Seletar West Road-3*\n🔴 Limit reached/exceeded · immediate attention\nMeter: VM01\nPPV: 5 mm/s\nApproved limit: 5 mm/s\nShare of limit: 100.0%\nReading time: 22 Oct 2026, 19:30 SGT"
      }
    ],
    "source": "vibration ppv-alert-preview samplePpvAlertMessages, provisional SKW/VM01 limits"
  }
};
