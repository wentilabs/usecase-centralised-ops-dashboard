import assert from "node:assert/strict";
import test from "node:test";

import { dayLoad, hourDetail, hourLabel, occurrencesFor } from "../lib/load-model/day-load";
import { LOAD_PROVIDERS } from "../lib/load-model/providers";
import { countFirst, scheduleHours, wbgtSenders, windowHours } from "../lib/load-model/helpers";
import { CRONS, sgtHours, within } from "../lib/load-model/crons";
import { SERVICE_KEYS, type ProjectConfigRow } from "../lib/services";

const row = (fields: Record<string, unknown>) => fields as unknown as ProjectConfigRow;

test("every service has a load provider, so a busy one cannot read as quiet", () => {
  for (const service of SERVICE_KEYS) {
    assert.ok(LOAD_PROVIDERS[service], `${service} has no load provider`);
  }
  assert.equal(Object.keys(LOAD_PROVIDERS).length, SERVICE_KEYS.length);
});

test("a disabled row contributes nothing at all", () => {
  for (const service of SERVICE_KEYS) {
    const load = LOAD_PROVIDERS[service].forRow(
      row({ project_code: "OFF", enabled: false, whatsapp_group_id: "1@g.us", wa_group_ids: "1@g.us" }),
    );
    assert.deepEqual(load, { occurrences: [], ambient: [] }, `${service} counts a disabled project`);
  }
});

test("an unset window is the whole day, which is what most rows have", () => {
  assert.equal(windowHours("", "").length, 24);
  assert.equal(windowHours("0700", null).length, 24, "a half-set window is not a half day");
  assert.deepEqual(windowHours("0700", "0900"), [7, 8, 9]);
  // A night shift wraps rather than collapsing to nothing.
  assert.deepEqual(windowHours("2200", "0200"), [0, 1, 2, 22, 23]);
});

test("a schedule column yields the hours it names and drops what it cannot parse", () => {
  assert.deepEqual(scheduleHours("0800,1;1600,2"), [8, 16]);
  assert.deepEqual(scheduleHours("1600,2;0800,1"), [8, 16], "hours come back in order");
  assert.deepEqual(scheduleHours("0800,1;0800,3"), [8], "the same hour twice is one hour");
  assert.deepEqual(scheduleHours("8am,1"), [], "an unparseable entry contributes no hour");
  assert.deepEqual(scheduleHours("2400,1"), [], "24:00 is not an hour");
  assert.deepEqual(scheduleHours(""), []);
});

test("a destination chain stops at the first column that holds anything", () => {
  const config = row({ own: "", shared: "a@g.us,b@g.us", legacy: "c@g.us" });
  // A fallback, not a union: counting both would double a project that has the
  // shared list set as well as the legacy one.
  assert.equal(countFirst(config, ["own", "shared", "legacy"]), 2);
  assert.equal(countFirst(config, ["own", "legacy"]), 1);
  assert.equal(countFirst(config, ["own"]), 0);
});

test("WBGT hourly fills its site hours and skips lunch when told to", () => {
  const load = LOAD_PROVIDERS.wbgt.forRow(
    row({
      project_code: "AST",
      enabled: true,
      whatsapp_group_id: "a@g.us,b@g.us",
      site_hours_start: 7,
      site_hours_end: 19,
      skip_lunch_hour: true,
    }),
  );
  const hourly = load.occurrences.filter((entry) => entry.cadence === "hourly report");
  // 07:00–19:00 is thirteen hours; lunch removes one.
  assert.equal(hourly.length, 12);
  assert.equal(hourly.some((entry) => entry.hour === 12), false, "12:00 is skipped");
  // Two groups, so two outbound actions per hour.
  assert.ok(hourly.every((entry) => entry.sends === 2 && entry.certainty === "scheduled"));
});

test("WBGT hourly is on unless it is explicitly off", () => {
  const base = { project_code: "AST", enabled: true, whatsapp_group_id: "a@g.us", site_hours_start: 8, site_hours_end: 9 };
  // The service reads `enable_hourly !== false`, so an absent column sends.
  assert.equal(LOAD_PROVIDERS.wbgt.forRow(row(base)).occurrences.length, 2);
  assert.equal(LOAD_PROVIDERS.wbgt.forRow(row({ ...base, enable_hourly: false })).occurrences.length, 0);
});

test("an MBS sensor-scoped project counts one sender per mapped sensor", () => {
  // Each sensor runs its own cycle to its own group, so the fan-out is per
  // sensor and NOT the project's group list.
  assert.equal(wbgtSenders(row({ delivery_scope: "sensor", sensor_delivery_groups: { A: "1@g.us", B: "2@g.us" } })), 2);
  assert.equal(wbgtSenders(row({ delivery_scope: "sensor", sensor_delivery_groups: '{"A":"1@g.us","B":"2@g.us","C":"3@g.us"}' })), 3);
  assert.equal(wbgtSenders(row({ delivery_scope: "project", sensor_delivery_groups: { A: "1@g.us", B: "2@g.us" } })), 1);
  // A malformed mapping still sends; zero would understate the project.
  assert.equal(wbgtSenders(row({ delivery_scope: "sensor", sensor_delivery_groups: "not json" })), 1);

  const load = LOAD_PROVIDERS.wbgt.forRow(
    row({
      project_code: "IR2",
      enabled: true,
      // Deliberately different from the sensor count: per-sensor delivery
      // REPLACES the project fan-out rather than multiplying it.
      whatsapp_group_id: "a@g.us,b@g.us,c@g.us,d@g.us,e@g.us",
      delivery_scope: "sensor",
      sensor_delivery_groups: { "Sensor 1": "1@g.us", "Sensor 2": "2@g.us" },
      site_hours_start: 8,
      site_hours_end: 8,
    }),
  );
  assert.deepEqual(
    load.occurrences.map((entry) => [entry.cadence, entry.sends]),
    [["hourly report", 2]],
  );
});

test("the noise 5-min cadence is scheduled or conditional by its formatter", () => {
  const base = {
    project_code: "SKW",
    enabled: true,
    whatsapp_group_id: "a@g.us",
    enable_5min: true,
    five_min_start_hhmm: "0800",
    five_min_end_hhmm: "0800",
  };
  // A summary formatter sends every tick; an exceedance one only on a breach.
  const summary = LOAD_PROVIDERS.noise.forRow(row({ ...base, five_min_formatter: "summary_with_limits" }));
  assert.deepEqual(summary.occurrences.map((e) => [e.certainty, e.sends]), [["scheduled", 12]]);
  const exceedance = LOAD_PROVIDERS.noise.forRow(row({ ...base, five_min_formatter: "exceedance_only" }));
  assert.deepEqual(exceedance.occurrences.map((e) => [e.certainty, e.sends]), [["conditional", 12]]);
});

test("the noise half-hourly relay is a second destination, not the same one", () => {
  const load = LOAD_PROVIDERS.noise.forRow(
    row({
      project_code: "SKW",
      enabled: true,
      whatsapp_group_id: "a@g.us",
      enable_half_hourly: true,
      half_hourly_start_hhmm: "0800",
      half_hourly_end_hhmm: "0800",
      half_hourly_send_if_exceed: true,
      exceedance_half_hourly_wa_groups: "x@g.us,y@g.us",
      'assessment_readings_mm_array("35,45,55")': "35,45,55",
    }),
  );
  assert.deepEqual(
    load.occurrences.map((entry) => [entry.cadence, entry.sends, entry.certainty]),
    [
      // Three assessment marks × one group.
      ["half-hourly assessment", 3, "scheduled"],
      // The relay reaches two other groups, and only for warning bands.
      ["half-hourly warning relay", 6, "conditional"],
    ],
  );
});

test("a haze override slot is counted once, and reaches past the working window", () => {
  const load = LOAD_PROVIDERS.haze.forRow(
    row({
      project_code: "CFC",
      enabled: true,
      wa_group_ids: "a@g.us",
      working_hours_start_hhmm: "0800",
      working_hours_end_hhmm: "1000",
      four_hourly: true,
    }),
  );
  const at8 = load.occurrences.filter((entry) => entry.hour === 8);
  // 08:00 is an override slot, so it is the guaranteed send and NOT also an
  // ordinary advisory — counting both would double the hour.
  assert.deepEqual(at8.map((entry) => entry.cadence), ["guaranteed 2-hourly send"]);
  // 20:00 fires although the window closed at 10:00.
  assert.ok(load.occurrences.some((entry) => entry.hour === 20));
  // The override replaces the kickoff.
  assert.equal(load.occurrences.some((entry) => entry.cadence === "daily kickoff"), false);
});

test("lightning is storm-driven apart from its one daily kickoff", () => {
  const load = LOAD_PROVIDERS.lightning.forRow(
    row({ project_code: "HLD", enabled: true, whatsapp_group_id: "a@g.us,b@g.us" }),
  );
  // 23:30 UTC — 07:30 Singapore. A real scheduled message, and the only
  // lightning send with an hour.
  assert.deepEqual(
    load.occurrences.map((entry) => [entry.hour, entry.cadence, entry.sends, entry.certainty]),
    [[7, "daily kickoff", 2, "scheduled"]],
  );
  // The alerts themselves stay off the clock. Sixty possible sends an hour
  // smeared across the day would swamp every real cadence with a number wrong
  // at every hour.
  assert.equal(load.ambient.length, 1);
  assert.equal(load.ambient[0].groups, 2);
  assert.match(load.ambient[0].reason, /no hour/i);
});

test("a chase that replies in the originating group is named, not counted", () => {
  const originating = LOAD_PROVIDERS.issueChaser.forRow(
    row({
      project_code: "AST",
      enabled: true,
      whatsapp_group_ids: "a@g.us,b@g.us",
      severity_cadence_chaser_enabled: true,
      severity_p1_window_start: "0800",
      severity_p1_window_end: "0800",
    }),
  );
  // The destination is whichever groups hold an open issue — a spreadsheet
  // fact, not a config one. Counting the configured list would be wrong.
  assert.deepEqual(originating.occurrences, []);
  assert.equal(originating.ambient.length, 1);
  assert.match(originating.ambient[0].reason, /originating group/);

  const redirected = LOAD_PROVIDERS.issueChaser.forRow(
    row({
      project_code: "AST",
      enabled: true,
      whatsapp_group_ids: "a@g.us,b@g.us",
      severity_cadence_chaser_enabled: true,
      severity_p1_window_start: "0800",
      severity_p1_window_end: "0800",
      send_to_originating_groups: false,
    }),
  );
  assert.deepEqual(
    redirected.occurrences.map((entry) => [entry.hour, entry.sends, entry.certainty]),
    [[8, 2, "conditional"]],
  );
  assert.deepEqual(redirected.ambient, []);
});

test("a chaser summary lands on its scheduled hours, at its own destination", () => {
  const load = LOAD_PROVIDERS.issueChaser.forRow(
    row({
      project_code: "AST",
      enabled: true,
      whatsapp_group_ids: "legacy@g.us",
      safety_summary_whatsapp_group_ids: "shared@g.us",
      daily_safety_summary_enabled: true,
      daily_safety_summary_schedule: "0800,1;1600,1",
      daily_safety_summary_whatsapp_group_ids: "own1@g.us,own2@g.us",
    }),
  );
  assert.deepEqual(
    load.occurrences.map((entry) => [entry.hour, entry.sends, entry.certainty]),
    [
      // Its own column wins over both fallbacks, so two groups and not one.
      [8, 2, "scheduled"],
      [16, 2, "scheduled"],
    ],
  );
});

test("subcon reports land on their rules' hours, gated by the start hour", () => {
  const base = {
    project_code: "AST",
    enabled: true,
    manpower_activity_outbound_group_id: "a@g.us",
    enable_activity_summary: true,
    enable_manpower_summary: true,
    enable_housekeeping: true,
    safety_group_ids: "h@g.us",
  };

  // Gate at 07: every rule hour is past it. The manpower route carries TWO
  // rules, so that report goes out twice a day.
  assert.deepEqual(
    LOAD_PROVIDERS.subcon.forRow(row({ ...base, morning_report_start_hour: 7 })).occurrences
      .map((entry) => [entry.hour, entry.cadence])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
    [
      [10, "manpower + machines report"],
      [12, "activity + manpower report"],
      [16, "manpower + machines report"],
      [22, "nightly housekeeping report"],
    ],
  );

  // Gate at 14: the 10:05 and 12:05 runs are before it and send nothing.
  // Housekeeping is a different route with no gate at all.
  assert.deepEqual(
    LOAD_PROVIDERS.subcon.forRow(row({ ...base, morning_report_start_hour: 14 })).occurrences
      .map((entry) => [entry.hour, entry.cadence])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
    [
      [16, "manpower + machines report"],
      [22, "nightly housekeeping report"],
    ],
  );

  // The nightly report has a real hour, so nothing is left without one.
  assert.deepEqual(LOAD_PROVIDERS.subcon.forRow(row({ ...base, morning_report_start_hour: 7 })).ambient, []);
});

test("a report with no destination group is no send at all", () => {
  // The card already says nothing is delivered; here it must not draw a bar.
  const load = LOAD_PROVIDERS.subcon.forRow(
    row({
      project_code: "AST",
      enabled: true,
      morning_report_start_hour: 7,
      manpower_activity_outbound_group_id: "",
      enable_activity_summary: true,
    }),
  );
  assert.deepEqual(load.occurrences, []);
});

test("the day has 24 buckets, and the busiest hour is the one with most sends", () => {
  const load = dayLoad({
    wbgt: [
      row({
        project_code: "AST",
        enabled: true,
        whatsapp_group_id: "a@g.us",
        site_hours_start: 8,
        site_hours_end: 9,
      }),
    ],
    subcon: [
      row({
        project_code: "AST",
        enabled: true,
        morning_report_start_hour: 8,
        manpower_activity_outbound_group_id: "b@g.us,c@g.us",
        // Its rule runs at 12:05 Singapore, not at the configured start hour.
        enable_activity_summary: true,
      }),
    ],
  });

  assert.equal(load.hours.length, 24, "every hour exists, empty or not");
  assert.deepEqual(load.hours.map((bucket) => bucket.hour), [...Array(24).keys()]);
  assert.equal(load.hours[8].scheduled, 1, "08:00 is the WBGT report alone");
  assert.equal(load.hours[9].scheduled, 1);
  assert.equal(load.hours[12].scheduled, 2, "subcon lands on its rule's hour, two groups");
  assert.equal(load.hours[0].total, 0);
  assert.equal(load.busiest[0].hour, 12);
  assert.equal(load.hours[8].groups, 1);
  assert.equal(load.hours[12].groups, 1);
  assert.deepEqual(load.hours[12].byService, { subcon: { scheduled: 2, conditional: 0 } });
  assert.equal(load.scheduled, 4);
});

test("the conditional ceiling can be left out of the totals", () => {
  const rows = {
    wbgt: [
      row({
        project_code: "AST",
        enabled: true,
        whatsapp_group_id: "a@g.us",
        site_hours_start: 8,
        site_hours_end: 8,
        enable_intermittent_reports: true,
        intermittent_reports_formatter: "red30",
      }),
    ],
  };
  const withCeiling = dayLoad(rows);
  assert.equal(withCeiling.hours[8].scheduled, 1);
  assert.equal(withCeiling.hours[8].conditional, 1);
  assert.equal(withCeiling.hours[8].total, 2);

  const floorOnly = dayLoad(rows, { includeConditional: false });
  // The conditional count is still reported — it is only kept out of the total,
  // so hiding the ceiling cannot also hide that there is one.
  assert.equal(floorOnly.hours[8].conditional, 1);
  assert.equal(floorOnly.hours[8].total, 1);
});

test("a service filter narrows the buckets and the ambient notes together", () => {
  const rows = {
    wbgt: [row({ project_code: "AST", enabled: true, whatsapp_group_id: "a@g.us", site_hours_start: 8, site_hours_end: 8 })],
    lightning: [row({ project_code: "AST", enabled: true, whatsapp_group_id: "a@g.us" })],
  };
  const all = dayLoad(rows);
  assert.equal(all.ambient.length, 1);
  assert.equal(all.hours[8].total, 1);

  const justLightning = dayLoad(rows, { services: ["lightning"] });
  assert.equal(justLightning.hours[8].total, 0);
  assert.equal(justLightning.ambient.length, 1);

  const justWbgt = dayLoad(rows, { services: ["wbgt"] });
  assert.equal(justWbgt.hours[8].total, 1);
  assert.deepEqual(justWbgt.ambient, [], "a filtered-out service keeps its note out too");
});

test("one hour's detail names every cadence in it, worst first", () => {
  const detail = hourDetail(
    {
      wbgt: [
        row({
          project_code: "AST",
          enabled: true,
          whatsapp_group_id: "a@g.us",
          site_hours_start: 8,
          site_hours_end: 19,
          water_parade_enabled: true,
          water_parade_outbound_group_id: "w1@g.us,w2@g.us,w3@g.us",
        }),
      ],
    },
    11,
  );
  assert.deepEqual(
    detail.map((entry) => [entry.cadence, entry.sends]),
    [
      // Three groups, and the rule fires TWICE an hour.
      ["Water Parade reminder", 6],
      ["hourly report", 1],
    ],
  );
  assert.deepEqual(hourDetail({ wbgt: [] }, 11), []);
});

test("the breakdown drops the ceiling when the chart does, so the rows add up", () => {
  const rows = {
    wbgt: [
      row({
        project_code: "AST",
        enabled: true,
        whatsapp_group_id: "a@g.us",
        site_hours_start: 8,
        site_hours_end: 8,
        enable_intermittent_reports: true,
        intermittent_reports_formatter: "red30",
      }),
    ],
  };
  // With the ceiling in, the rows sum to the bar; with it out, they still do.
  const both = hourDetail(rows, 8);
  assert.equal(both.length, 2);
  assert.equal(both.reduce((sum, entry) => sum + entry.sends, 0), dayLoad(rows).hours[8].total);

  const floorOnly = hourDetail(rows, 8, { includeConditional: false });
  assert.deepEqual(floorOnly.map((entry) => entry.cadence), ["hourly report"]);
  assert.equal(
    floorOnly.reduce((sum, entry) => sum + entry.sends, 0),
    dayLoad(rows, { includeConditional: false }).hours[8].total,
  );
});

test("a service with rows but no provider is skipped rather than counted as quiet", () => {
  // `occurrencesFor` is given a plain object, so a key that is not a service
  // can reach it — from a stale cache, or a service added to the dashboard
  // before its provider exists.
  const { occurrences } = occurrencesFor({
    invented: [row({ project_code: "X", enabled: true })],
  } as never);
  assert.deepEqual(occurrences, []);
});

test("hours read as clock times", () => {
  assert.equal(hourLabel(0), "00:00");
  assert.equal(hourLabel(8), "08:00");
  assert.equal(hourLabel(23), "23:00");
});

test("UTC rules are read as Singapore hours", () => {
  // Every expression in the table is UTC, and the console's own labels prove
  // the offset: cron(0 11 * * ? *) is named "Noise Evening Summary 7PM".
  assert.deepEqual(sgtHours(11), [19]);
  assert.deepEqual(sgtHours(23), [7], "23:00 UTC wraps into the next Singapore morning");
  assert.deepEqual(sgtHours(2, 5, 8, 11), [10, 13, 16, 19]);
  assert.deepEqual(sgtHours(16, 16), [0], "the same hour twice is one hour, and 16 UTC is midnight");
  assert.deepEqual(CRONS.noise.evening.hours, [19]);
  assert.deepEqual(CRONS.noise.morning.hours, [7]);
  assert.deepEqual(CRONS.issueChaser.chatgroupSummary.hours, [8]);
});

test("a configured hour only counts when its rule runs in it", () => {
  assert.deepEqual(within([8, 16], CRONS.issueChaser.safetySummary), [8, 16], "an hourly rule allows both");
  assert.deepEqual(within([8, 16], CRONS.issueChaser.chatgroupSummary), [8], "a daily rule allows only its own hour");
  assert.deepEqual(within([16], CRONS.issueChaser.chatgroupSummary), []);
});

test("a chaser summary scheduled outside its rule's hour is reported, not drawn", () => {
  const load = LOAD_PROVIDERS.issueChaser.forRow(
    row({
      project_code: "AST",
      enabled: true,
      whatsapp_group_ids: "a@g.us,b@g.us",
      // Two styles, the same pair of hours. The plain summary runs hourly so
      // both fire; the chat-group split runs once a day at 08:00, so its 16:00
      // entry can never fire.
      daily_safety_summary_enabled: true,
      daily_safety_summary_schedule: "0800,3;1600,3",
      daily_safety_chatgroup_summary_enabled: true,
      daily_safety_chatgroup_summary_schedule: "0800,3;1600,3",
    }),
  );

  assert.deepEqual(
    load.occurrences.map((entry) => [entry.hour, entry.cadence, entry.sends]).sort(),
    [
      // `0800,3` — at 08:00, to every group this style resolves to. The 3 is
      // the lookback and changes what the message says, never how many go out.
      [8, "past-days safety summary", 2],
      [8, "…split by chat group", 2],
      [16, "past-days safety summary", 2],
    ].sort(),
  );

  // The stranded 16:00 entry is a silent misconfiguration: the project looks
  // scheduled and sends nothing. Named rather than left as an absent bar.
  const stranded = load.ambient.filter((entry) => /never sends/.test(entry.reason));
  assert.equal(stranded.length, 1);
  assert.match(stranded[0].reason, /split by chat group is scheduled for 16:00/);
  assert.match(stranded[0].reason, /only runs at 08:00/);
});

test("the cadences whose hour comes from a rule rather than a column", () => {
  // The noise morning summary is invoked once a day at 07:00 Singapore, so the
  // column cannot move it — it describes the period summarised, not the send.
  const noise = LOAD_PROVIDERS.noise.forRow(
    row({
      project_code: "SKW",
      enabled: true,
      whatsapp_group_id: "a@g.us",
      enable_morning_summary: true,
      morning_summary_start_hhmm: "0300",
    }),
  );
  assert.deepEqual(noise.occurrences.map((entry) => [entry.hour, entry.cadence]), [[7, "morning summary"]]);

  // The haze kickoff is 07:45 Singapore on its own rule, not the project's
  // working-hours start.
  const haze = LOAD_PROVIDERS.haze.forRow(
    row({
      project_code: "CFC",
      enabled: true,
      wa_group_ids: "a@g.us",
      working_hours_start_hhmm: "0900",
      working_hours_end_hhmm: "0900",
    }),
  );
  assert.ok(haze.occurrences.some((entry) => entry.hour === 7 && entry.cadence === "daily kickoff"));

  // Ailytics' issues status summary has no hour column at all: 18:00, daily.
  const ailytics = LOAD_PROVIDERS.ailytics.forRow(
    row({ project_code: "AST", enabled: true, status_summary_enabled: true, whatsapp_group_ids: "a@g.us,b@g.us" }),
  );
  assert.deepEqual(
    ailytics.occurrences.map((entry) => [entry.hour, entry.cadence, entry.sends]),
    [[18, "issues status summary", 2]],
  );
});

test("Water Parade reminders run twice an hour, and only from 11:00 to 19:00", () => {
  const load = LOAD_PROVIDERS.wbgt.forRow(
    row({
      project_code: "IR2",
      enabled: true,
      whatsapp_group_id: "a@g.us",
      site_hours_start: 7,
      site_hours_end: 23,
      enable_hourly: false,
      water_parade_enabled: true,
      water_parade_outbound_group_id: "w1@g.us,w2@g.us",
    }),
  );
  const hours = load.occurrences.map((entry) => entry.hour);
  assert.deepEqual(hours, [11, 12, 13, 14, 15, 16, 17, 18, 19], "the rule is UTC 03-11, not the whole site day");
  // Two groups on a rule that fires at :30 and :56.
  assert.ok(load.occurrences.every((entry) => entry.sends === 4));
});


test("the on-demand company backlog is named, never drawn", () => {
  const load = LOAD_PROVIDERS.issueChaser.forRow(
    row({
      project_code: "AST",
      enabled: true,
      whatsapp_group_ids: "a@g.us",
      company_open_backlog_enabled: true,
      send_to_originating_groups: false,
    }),
  );
  // Nothing in the console invokes /api/issue-chaser-company-open, so it has
  // no hour — but it is a real burst when somebody runs it.
  assert.deepEqual(load.occurrences, []);
  const note = load.ambient.find((entry) => /company open backlog/i.test(entry.reason));
  assert.ok(note, "an enabled backlog must be named somewhere");
  assert.match(note.reason, /on demand only/i);

  // Off is silent — an unlit capability is not worth a line.
  assert.equal(
    LOAD_PROVIDERS.issueChaser.forRow(
      row({ project_code: "AST", enabled: true, whatsapp_group_ids: "a@g.us", send_to_originating_groups: false }),
    ).ambient.some((entry) => /company open backlog/i.test(entry.reason)),
    false,
  );
});
