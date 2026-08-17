"use strict";

// ---------- state ----------
let DATA = { headerLinks: {}, meta: {} };
let USECASES = ["wbgt", "noise"]; // replaced by server meta on first load
let TAB = "wbgt";
let QUERY = "";

const HEADER_LINKS = [
  { key: "supabase", label: "Supabase Table" },
  { key: "echo", label: "Echo Lambda" },
  { key: "lambda", label: "AWS Lambda" },
  { key: "cloudwatch", label: "CloudWatch Logs" },
  { key: "noiselynx", label: "Noiselynx" },
];

const $ = (sel, el = document) => el.querySelector(sel);
const cardsEl = $("#cards");
const statusEl = $("#status");
const ctxEl = $("#ctxmenu");

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const sheetUrl = (id) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;

function splitGroups(v) {
  return String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function fmtHHMM(v) {
  const s = String(v ?? "").padStart(4, "0");
  return /^\d{4}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2)}` : String(v ?? "—");
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-SG", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Noise repo's quirky literal column name
const ASSESS_COL = 'assessment_readings_mm_array("35,45,55")';

// ---------- fires-at derivation ----------
function wbgtFires(c) {
  const parts = [];
  if (c.enable_hourly) parts.push("<b>:00</b> hourly");
  if (c.enable_intermittent_reports) {
    // intermittent_reports_formatter: red15 (default) fires :30 on Moderate+
    // and :15/:45 on High; red30 fires :30 on High only.
    parts.push(
      String(c.intermittent_reports_formatter || "red15").toLowerCase() === "red30"
        ? "<b>:30</b> if High"
        : "<b>:30</b> if Moderate+, <b>:15/:45</b> if High",
    );
  }
  if (c.enable_5min_alerts) parts.push("<b>5-min</b> on 32/33°C crossings");
  if (!parts.length) return "No cadences enabled";
  let s = parts.join(" · ") + ` — site hours <b>${esc(c.site_hours_start)}:00–${esc(c.site_hours_end)}:00</b>`;
  if (c.skip_lunch_hour) s += ", skips 12:00";
  if (c.remove_sunday_notifications) s += ", muted Sundays";
  if (c.remove_ph_notifications) s += ", muted PH";
  return s;
}

function noiseFires(c) {
  const parts = [];
  const win = (a, b) => (a || b ? ` (${fmtHHMM(a)}–${fmtHHMM(b)})` : "");
  if (c.enable_5min) parts.push(`<b>5-min</b>${win(c.five_min_start_hhmm, c.five_min_end_hhmm)}`);
  if (c.enable_half_hourly) {
    const mm = String(c[ASSESS_COL] ?? c.assessment_readings_mm_array ?? "30");
    parts.push(`<b>half-hourly</b> @ :${esc(mm.split(",").map((m) => m.trim().padStart(2, "0")).join(" :"))}${win(c.half_hourly_start_hhmm, c.half_hourly_end_hhmm)}`);
  }
  if (c.enable_hourly) parts.push(`<b>hourly</b>${win(c.hourly_start_hhmm, c.hourly_end_hhmm)}`);
  // These are gated by their own enable_* flags — the formatter columns only
  // pick the message shape and can be set while the cadence is off.
  if (c.enable_three_hour_summary) parts.push("<b>3-hr summary</b>");
  if (c.enable_morning_summary) parts.push(`<b>morning</b>${c.morning_summary_start_hhmm ? ` @ ${fmtHHMM(c.morning_summary_start_hhmm)}` : ""}`);
  if (c.enable_sunday_leq12h_hourly) parts.push("<b>Sunday Leq12h</b> hourly");
  if (c.enable_7am_7pm_leq12hr_table) parts.push("<b>Leq12hr table</b> @ 07:00/19:00");
  if (!parts.length) return "No cadences enabled";
  const mutes = [];
  if (c.remove_sunday_notifications) mutes.push("Sundays");
  if (c.remove_ph_notifications) mutes.push("PH");
  return parts.join(" · ") + (mutes.length ? ` — muted ${mutes.join(" + ")}` : "");
}

// ---------- rendering ----------
function pill(label, on) {
  return `<span class="pill ${on ? "on" : "off"}">${esc(label)}</span>`;
}

function linkBtn(label, href, cls = "") {
  return `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`;
}

function autoLinks(usecase, c) {
  const out = [];
  if (c.monthly_sheet_id) out.push(linkBtn("📗 Monthly sheet", sheetUrl(c.monthly_sheet_id)));
  if (c.google_sheet_id) out.push(linkBtn("📗 Analysis sheet", sheetUrl(c.google_sheet_id)));
  if (c.spreadsheet_id) out.push(linkBtn("📗 Safety sheet", sheetUrl(c.spreadsheet_id)));
  if (c.latitude && c.longitude) {
    out.push(linkBtn("📍 Map", `https://www.google.com/maps?q=${encodeURIComponent(c.latitude + "," + c.longitude)}`));
  }
  return out;
}

function manualLinks(usecase, c) {
  return (c._links || []).map((l) => {
    if (l.url) return `<a class="manual" data-link-id="${esc(l.id)}" href="${esc(l.url)}" target="_blank" rel="noopener">🔖 ${esc(l.label)}</a>`;
    return `<span class="note-item" data-link-id="${esc(l.id)}" title="${esc(l.note)}">📝 ${esc(l.label)}: ${esc(l.note)}</span>`;
  });
}

function whatsappChips(c) {
  const groups = splitGroups(c.whatsapp_group_id);
  if (!groups.length) return `<span class="chip"><span class="chip-k">no group configured</span></span>`;
  return groups.map((g) => `<span class="chip" title="WhatsApp group">💬 ${esc(g)}</span>`).join("");
}

function groupChips(raw) {
  const groups = splitGroups(raw);
  if (!groups.length) return `<span class="chip"><span class="chip-k">no group configured</span></span>`;
  return groups.map((g) => `<span class="chip" title="WhatsApp group">💬 ${esc(g)}</span>`).join("");
}

function chip(key, value, title = "") {
  return `<span class="chip"${title ? ` title="${esc(title)}"` : ""}><span class="chip-k">${esc(key)}</span> ${esc(value)}</span>`;
}

function cardWBGT(c) {
  // enable_scrape=false → manual-only project: readings arrive via the
  // WhatsApp/Telegram photo-ingestion endpoints instead of CloudLynx.
  const manualOnly = c.enable_scrape === false;
  const telegram = splitGroups(c.telegram_chat_ids);
  const sourceChats = splitGroups(c.whatsapp_wbgt_source_chat_ids);
  const pocGroups = splitGroups(c.poc_alert_wa_groups);
  const pocPhones = splitGroups(c.poc_phone_numbers);
  return `
    <div class="pills">
      ${pill("hourly", c.enable_hourly)}
      ${pill("intermittent", c.enable_intermittent_reports)}
      ${pill("5-min alerts", c.enable_5min_alerts)}
      ${pill("scrape", !manualOnly)}
      ${pill("skip lunch", c.skip_lunch_hour)}
      ${pill("mute Sundays", c.remove_sunday_notifications)}
      ${pill("mute PH", c.remove_ph_notifications)}
      ${pill("POC mentions", c.enable_red_band_poc_mentions)}
    </div>
    <div>
      <div class="section-label">Formats</div>
      <div class="chips">
        ${c.enable_intermittent_reports ? chip("interm", c.intermittent_reports_formatter || "red15 (default)") : ""}
        ${chip("5min", c.five_min_alert_formatter || "short")}
        ${chip("sheet fill", c.monthly_sheet_fill_mode || "window")}
      </div>
    </div>
    <div>
      <div class="section-label">Fires at</div>
      <div class="fires">${wbgtFires(c)}</div>
    </div>
    <div>
      <div class="section-label">Delivery</div>
      <div class="chips">
        ${whatsappChips(c)}
        ${telegram.map((t) => chip("tg", t, "Telegram chat")).join("")}
        ${c.enable_red_band_poc_mentions && pocGroups.length ? pocGroups.map((g) => chip("poc grp", g, "Group where POCs get @mentioned on 🔴")).join("") : ""}
        ${c.enable_red_band_poc_mentions && pocPhones.length ? chip("poc", `${pocPhones.length} number${pocPhones.length === 1 ? "" : "s"}`, pocPhones.join(", ")) : ""}
        ${c.enable_red_band_poc_mentions && !pocPhones.length ? chip("poc", "⚠️ none configured") : ""}
      </div>
    </div>
    ${manualOnly ? `
    <div>
      <div class="section-label">Manual ingestion</div>
      <div class="chips">
        ${sourceChats.length ? sourceChats.map((s) => chip("wa src", s, "Source chat for meter photos")).join("") : chip("wa src", "none")}
        ${c.whatsapp_manual_sensor_label ? chip("wa label", c.whatsapp_manual_sensor_label) : ""}
        ${c.telegram_manual_sensor_label ? chip("tg label", c.telegram_manual_sensor_label) : ""}
      </div>
    </div>` : ""}
    ${c.top_of_hour_band ? `<div class="fires">Current band: <b>${esc(c.top_of_hour_band)}</b></div>` : ""}
    ${c.enable_5min_alerts && c.last_5min_alert_level ? `<div class="fires">5-min alert zone: <b>${esc(c.last_5min_alert_level)}</b> <span style="opacity:.7">(${fmtDate(c.last_5min_alert_at)})</span></div>` : ""}
  `;
}

function cardNoise(c) {
  const expiryGroups = splitGroups(c.alert_whatsapp_gid);
  return `
    <div class="pills">
      ${pill("5-min", c.enable_5min)}
      ${pill("half-hourly", c.enable_half_hourly)}
      ${pill("hourly", c.enable_hourly)}
      ${pill("3-hr summary", c.enable_three_hour_summary)}
      ${pill("morning summary", c.enable_morning_summary)}
      ${pill("Sunday Leq12h", c.enable_sunday_leq12h_hourly)}
      ${pill("Leq12hr table", c.enable_7am_7pm_leq12hr_table)}
      ${pill("mute Sundays", c.remove_sunday_notifications)}
      ${pill("mute PH", c.remove_ph_notifications)}
      ${pill("expiry alerts", c.allow_expiry_alert)}
    </div>
    <div>
      <div class="section-label">Message formats</div>
      <div class="chips">
        ${chip("5min", c.five_min_formatter)}
        ${chip("½hr", c.half_hourly_formatter)}
        ${chip("1hr", c.hourly_formatter)}
        ${c.three_hour_formatter ? chip("3hr", c.three_hour_formatter) : ""}
        ${c.morning_formatter ? chip("am", c.morning_formatter) : ""}
      </div>
    </div>
    <div>
      <div class="section-label">Fires at</div>
      <div class="fires">${noiseFires(c)}</div>
    </div>
    <div>
      <div class="section-label">Delivery</div>
      <div class="chips">${whatsappChips(c)}</div>
    </div>
    ${c.allow_expiry_alert ? `
    <div>
      <div class="section-label">Meter expiry alerts</div>
      <div class="chips">
        ${chip("warn at", `${esc(c.days_left_before_alerting)} days left`)}
        ${expiryGroups.length ? expiryGroups.map((g) => chip("to", g, "Expiry alert recipient")).join("") : chip("to", "⚠️ no group set")}
      </div>
    </div>` : ""}
  `;
}


function rowId(usecase, c) {
  const idCol = DATA.meta?.[usecase]?.idColumn || "project_code";
  return c[idCol];
}

function usecaseLabel(usecase) {
  return (DATA.meta?.[usecase]?.label || usecase).toUpperCase();
}

function hoursLine(c, startKey = "working_hours_start_hhmm", endKey = "working_hours_end_hhmm") {
  const a = c[startKey];
  const b = c[endKey];
  if (!a && !b) return "all day";
  return `${fmtHHMM(a)}–${fmtHHMM(b)}`;
}

function mutesSuffix(c) {
  const m = [];
  if (c.remove_sunday_notifications) m.push("Sundays");
  if (c.remove_ph_notifications) m.push("PH");
  return m.length ? ` — muted ${m.join(" + ")}` : "";
}

function cardHaze(c) {
  return `
    <div class="pills">
      ${pill("mute Sundays", c.remove_sunday_notifications)}
      ${pill("mute PH", c.remove_ph_notifications)}
    </div>
    <div>
      <div class="section-label">Fires at</div>
      <div class="fires"><b>hourly</b> advisory during <b>${hoursLine(c)}</b>${mutesSuffix(c)}</div>
    </div>
    <div>
      <div class="section-label">NEA source</div>
      <div class="chips">
        ${chip("region", c.nea_region || "—")}
        ${c.latitude && c.longitude ? chip("lat/lng", `${c.latitude}, ${c.longitude}`) : ""}
      </div>
    </div>
    <div>
      <div class="section-label">Delivery</div>
      <div class="chips">${groupChips(c.wa_group_ids)}</div>
    </div>
    ${c.site_address ? `<div class="fires">${esc(c.site_address)}</div>` : ""}
  `;
}

function cardLightning(c) {
  const types = (v) => (Array.isArray(v) ? v.join("+") : String(v || "—"));
  return `
    <div class="pills">
      ${pill(`red ${c.red_radius_m ?? "?"}m`, c.red_radius_m)}
      ${pill(`amber ${c.amber_radius_m ?? "?"}m`, c.amber_radius_m)}
      ${pill(`v${c.config_version ?? 1}`, true)}
      ${pill("mute Sundays", c.remove_sunday_notifications)}
      ${pill("mute PH", c.remove_ph_notifications)}
    </div>
    <div>
      <div class="section-label">Thresholds</div>
      <div class="chips">
        ${chip("🔴", `${c.red_radius_m ?? "—"}m · ${types(c.red_detection_types)} · dwell ${c.red_dwell_seconds ?? "—"}s`)}
        ${chip("🟠", `${c.amber_radius_m ?? "—"}m · ${types(c.amber_detection_types)} · dwell ${c.amber_dwell_seconds ?? "—"}s`)}
        ${c.site_extent_radius_m ? chip("site extent", `${c.site_extent_radius_m}m`) : ""}
      </div>
    </div>
    <div>
      <div class="section-label">Fires at</div>
      <div class="fires">every tick while a qualifying strike is in range — working hours <b>${hoursLine(c)}</b>${mutesSuffix(c)}</div>
    </div>
    <div>
      <div class="section-label">Delivery</div>
      <div class="chips">${groupChips(c.whatsapp_group_id)}</div>
    </div>
    ${c.policy_note ? `<div class="fires">📝 ${esc(c.policy_note)}</div>` : ""}
  `;
}

function cardAilytics(c) {
  return `
    <div class="pills">
      ${pill("telegram source", c.telegram_chat_id)}
      ${pill("sheet", c.spreadsheet_id)}
      ${pill("whatsapp relay", c.whatsapp_group_ids)}
    </div>
    <div>
      <div class="section-label">Telegram source</div>
      <div class="chips">
        ${chip("chat", c.telegram_chat_id || "—")}
        ${c.upstream_bot_username ? chip("bot", c.upstream_bot_username) : ""}
        ${c.expected_chat_title ? chip("title", c.expected_chat_title) : ""}
      </div>
    </div>
    <div>
      <div class="section-label">Sheet tabs</div>
      <div class="chips">
        ${chip("safety", c.safety_sheet_tab || "—")}
        ${chip("history", c.activity_history_tab || "—")}
      </div>
    </div>
    <div>
      <div class="section-label">Delivery</div>
      <div class="chips">${groupChips(c.whatsapp_group_ids)}</div>
    </div>
    <div class="fires">Event-driven — fires when the CCTV bot posts.</div>
  `;
}

const CARD_RENDERERS = { wbgt: cardWBGT, noise: cardNoise, haze: cardHaze, lightning: cardLightning, ailytics: cardAilytics };

function hasCadence(usecase, c) {
  if (usecase !== "wbgt" && usecase !== "noise") return c.enabled !== false;
  return usecase === "wbgt"
    ? Boolean(c.enable_hourly || c.enable_intermittent_reports || c.enable_5min_alerts)
    : Boolean(
        c.enable_5min || c.enable_half_hourly || c.enable_hourly ||
        c.enable_three_hour_summary || c.enable_morning_summary ||
        c.enable_sunday_leq12h_hourly || c.enable_7am_7pm_leq12hr_table,
      );
}

function renderCard(usecase, c) {
  const links = [...autoLinks(usecase, c), ...manualLinks(usecase, c)];
  const cls = [c.enabled ? "" : "disabled", hasCadence(usecase, c) ? "" : "nocad"].join(" ");
  return `
  <article class="card ${cls}" data-usecase="${usecase}" data-project="${esc(rowId(usecase, c))}">
    <h2>
      <span class="usecase-tag ${usecase}">${esc(usecaseLabel(usecase))}</span>
      ${esc(c.project_code)}
      <span class="enabled-badge ${c.enabled ? "on" : "off"}">${c.enabled ? "● ENABLED" : "○ DISABLED"}</span>
      ${SESSION.canEdit ? `<button class="edit-btn" title="Edit this project's Supabase config">⚙︎ Edit</button>` : ""}
    </h2>
    ${(CARD_RENDERERS[usecase] || (() => ""))(c)}
    <div>
      <div class="section-label">Links <span style="font-weight:400">(right-click card to add)</span></div>
      <div class="links">${links.join("") || '<span class="chip"><span class="chip-k">none</span></span>'}</div>
    </div>
    <footer>
      <span>${esc(c.source_type || "default")} · ${esc(c.timezone || "Asia/Singapore")}</span>
      <span>updated ${fmtDate(c.updated_at)}</span>
    </footer>
  </article>`;
}

function renderHeaderLinks() {
  const saved = (DATA.headerLinks && DATA.headerLinks[TAB]) || {};
  $("#headerlinks").innerHTML = HEADER_LINKS.map(({ key, label }) => {
    const url = saved[key];
    return url
      ? `<a data-hkey="${key}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`
      : `<a data-hkey="${key}" class="unset" href="#" title="Click to set URL">${esc(label)} ✎</a>`;
  }).join("");
}

function renderTabs() {
  const nav = $("#tabs");
  if (nav.dataset.built === USECASES.join(",")) return;
  nav.dataset.built = USECASES.join(",");
  nav.innerHTML = USECASES.map(
    (u) => `<button data-tab="${esc(u)}"${u === TAB ? ' class="active"' : ""}>${esc(DATA.meta?.[u]?.label || u)}</button>`,
  ).join("");
}

function render() {
  renderTabs();
  renderHeaderLinks();
  const usecase = TAB;
  const list = Array.isArray(DATA[usecase]) ? DATA[usecase] : [];
  const rows = list
    .filter((c) => !QUERY || String(c.project_code).toLowerCase().includes(QUERY))
    .sort((a, b) => {
      const cad = hasCadence(usecase, b) - hasCadence(usecase, a); // no-cadence last
      return cad || String(a.project_code).localeCompare(String(b.project_code));
    })
    .map((c) => renderCard(usecase, c));
  cardsEl.innerHTML = rows.join("") || $("#tpl-empty").innerHTML;

  if (DATA[usecase] && !Array.isArray(DATA[usecase]) && DATA[usecase].error) {
    statusEl.textContent = `⚠️ ${usecase}: ${DATA[usecase].error}`;
  }
}

// ---------- data ----------
async function loadSession() {
  try {
    const res = await fetch("/api/auth/session");
    if (!res.ok) return;
    SESSION = await res.json();
    renderIdentity();
  } catch (_) {
    /* leave defaults; the server is the real gate */
  }
}

function renderIdentity() {
  const el = $("#identity");
  if (!el) return;
  if (SESSION.localBypass && !SESSION.email) {
    el.innerHTML = `<span class="who" title="Local development bypass — no auth required on loopback">local</span>`;
    return;
  }
  const ro = SESSION.canEdit ? "" : ` <span class="ro-badge" title="Your account may view but not change configs">read-only</span>`;
  el.innerHTML = `<span class="who">${esc(SESSION.email || "signed out")}</span>${ro}` +
    `<button id="signout" class="ghost" title="Sign out">Sign out</button>`;
  const btn = $("#signout");
  if (btn) btn.addEventListener("click", async () => {
    await fetch("/api/auth/sign-out", { method: "POST" });
    location.replace("/login");
  });
}

async function refresh() {
  statusEl.textContent = "Loading…";
  try {
    const res = await fetch("/api/projects");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.status);
    DATA = body;
    if (body.meta && Object.keys(body.meta).length) USECASES = Object.keys(body.meta);
    if (!USECASES.includes(TAB)) TAB = USECASES[0];
    const count = (u) => (Array.isArray(body[u]) ? body[u].length : 0);
    statusEl.textContent =
      USECASES.map((u) => `${count(u)} ${body.meta?.[u]?.label || u}`).join(" · ") + ` · fetched ${fmtDate(body.fetchedAt)}`;
    render();
  } catch (err) {
    statusEl.textContent = `⚠️ ${err.message}`;
  }
}

// ---------- context menu ----------
function hideMenu() {
  ctxEl.hidden = true;
  ctxEl.innerHTML = "";
}

function showMenu(x, y, items) {
  ctxEl.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.textContent = it.label;
    if (it.danger) b.className = "danger";
    b.addEventListener("click", () => { hideMenu(); it.action(); });
    ctxEl.appendChild(b);
  }
  ctxEl.hidden = false;
  const rect = ctxEl.getBoundingClientRect();
  ctxEl.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
  ctxEl.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
}

async function addLink(usecase, project) {
  const label = prompt(`Link label for ${project}? (e.g. "AWS console", "EventBridge rule")`);
  if (!label) return;
  const url = prompt("URL?");
  if (!url) return;
  await fetch(`/api/links/${usecase}/${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, url }),
  });
  refresh();
}

async function addNote(usecase, project) {
  const label = prompt(`Note title for ${project}?`);
  if (!label) return;
  const note = prompt("Note text?");
  if (!note) return;
  await fetch(`/api/links/${usecase}/${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, note }),
  });
  refresh();
}

async function deleteLink(usecase, project, id) {
  await fetch(`/api/links/${usecase}/${encodeURIComponent(project)}/${id}`, { method: "DELETE" });
  refresh();
}

async function setHeaderLink(key, label, current) {
  const url = prompt(`URL for "${label}" (${TAB.toUpperCase()})? Leave empty to clear.`, current || "");
  if (url === null) return;
  await fetch(`/api/header/${TAB}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, url: url.trim() }),
  });
  refresh();
}

$("#headerlinks").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-hkey]");
  if (!a) return;
  if (a.classList.contains("unset")) {
    e.preventDefault();
    const def = HEADER_LINKS.find((h) => h.key === a.dataset.hkey);
    setHeaderLink(a.dataset.hkey, def ? def.label : a.dataset.hkey);
  }
});

document.addEventListener("contextmenu", (e) => {
  const headerLink = e.target.closest("#headerlinks a[data-hkey]");
  if (headerLink) {
    e.preventDefault();
    const key = headerLink.dataset.hkey;
    const def = HEADER_LINKS.find((h) => h.key === key);
    const current = ((DATA.headerLinks || {})[TAB] || {})[key] || "";
    return showMenu(e.clientX, e.clientY, [
      { label: "✎ Set / edit URL…", action: () => setHeaderLink(key, def ? def.label : key, current) },
      { label: "🗑 Clear URL", danger: true, action: () => {
          fetch(`/api/header/${TAB}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, url: "" }) }).then(refresh);
        } },
    ]);
  }
  const card = e.target.closest(".card");
  if (!card) return hideMenu();
  e.preventDefault();
  const usecase = card.dataset.usecase;
  const project = card.dataset.project;
  const linkEl = e.target.closest("[data-link-id]");
  const items = [
    { label: "➕ Add link…", action: () => addLink(usecase, project) },
    { label: "📝 Add note…", action: () => addNote(usecase, project) },
  ];
  if (linkEl) {
    items.push({ label: "🗑 Delete this item", danger: true, action: () => deleteLink(usecase, project, linkEl.dataset.linkId) });
  }
  showMenu(e.clientX, e.clientY, items);
});
document.addEventListener("click", hideMenu);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideMenu(); });

// ---------- controls ----------
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  TAB = b.dataset.tab;
  for (const btn of $("#tabs").children) btn.classList.toggle("active", btn === b);
  render();
});
$("#search").addEventListener("input", (e) => {
  QUERY = e.target.value.trim().toLowerCase();
  render();
});
$("#refresh").addEventListener("click", refresh);

loadSession().then(refresh);

// ===================== config editor =====================
// The dashboard is the control surface for Supabase: every field below is
// written back through PATCH /api/config/:usecase/:project, validated against
// the live schema, guarded by an updated_at check, and audit-logged.

let SESSION = { allowed: true, canEdit: true, email: null, localBypass: true };
let SCHEMA = null;          // { wbgt: {fields, groups}, noise: {...} }
let EDIT = null;            // { usecase, projectCode, row, draft }

const editorEl = $("#editor");
const scrimEl = $("#scrim");

function toast(message, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "err" ? 9000 : 4000);
}

async function loadSchema() {
  if (SCHEMA) return SCHEMA;
  const res = await fetch("/api/schema");
  if (!res.ok) throw new Error("schema unavailable");
  SCHEMA = await res.json();
  return SCHEMA;
}

function displayValue(v) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function fieldControl(field, value) {
  const id = `f_${field.name.replace(/\W/g, "_")}`;
  const dis = field.readonly ? " disabled" : "";
  if (field.readonly) return `<div class="ro-value">${esc(displayValue(value))}</div>`;

  if (field.widget === "toggle") {
    const on = value === true;
    return `<label class="switch">
      <input type="checkbox" id="${id}" data-field="${esc(field.name)}"${on ? " checked" : ""}${dis}>
      <span class="track"></span><span class="state">${on ? "on" : "off"}</span>
    </label>`;
  }
  if (field.widget === "select") {
    const opts = ["", ...(field.options || [])]
      .map((o) => `<option value="${esc(o)}"${String(value ?? "") === o ? " selected" : ""}>${o === "" ? "— not set —" : esc(o)}</option>`)
      .join("");
    return `<select id="${id}" data-field="${esc(field.name)}"${dis}>${opts}</select>`;
  }
  if (field.widget === "number") {
    return `<input type="number" id="${id}" data-field="${esc(field.name)}" value="${esc(value ?? "")}"${dis}>`;
  }
  if (field.widget === "multi" || field.type === "array") {
    const selected = Array.isArray(value) ? value : splitGroups(value);
    return `<div class="multi" data-field="${esc(field.name)}" data-multi="1">${(field.options || [])
      .map((o) => `<label class="multi-opt"><input type="checkbox" value="${esc(o)}"${selected.includes(o) ? " checked" : ""}${dis}> ${esc(o)}</label>`)
      .join("")}</div>`;
  }
  if (field.widget === "csv") {
    return `<textarea id="${id}" data-field="${esc(field.name)}" spellcheck="false" placeholder="comma-separated"${dis}>${esc(value ?? "")}</textarea>`;
  }
  if (field.widget === "hhmm") {
    return `<input type="text" id="${id}" data-field="${esc(field.name)}" value="${esc(value ?? "")}" placeholder="HHMM e.g. 0730" maxlength="4"${dis}>`;
  }
  return `<input type="text" id="${id}" data-field="${esc(field.name)}" value="${esc(value ?? "")}" spellcheck="false"${dis}>`;
}

function renderEditor() {
  const { usecase, row } = EDIT;
  const spec = SCHEMA[usecase];
  $("#editor-title").innerHTML =
    `<span class="usecase-tag ${usecase}">${esc(usecaseLabel(usecase))}</span> ${esc(row.project_code || rowId(usecase, row))}`;
  $("#editor-sub").textContent = `Editing live Supabase config · last updated ${fmtDate(row.updated_at)}`;

  $("#editor-body").innerHTML = spec.groups
    .map((g) => `<section class="fieldgroup"><h3>${esc(g.title)}</h3>${renderFields(spec, row, g.fields)}</section>`)
    .join("");

  applyConditionalVisibility();
  updateDirty();
}

// One field. `compact` stacks the label above the control so two or three fit
// side by side inside a .field-row.
function renderField(spec, row, name, compact = false) {
  const field = spec.fields[name];
  const value = EDIT.draft[name] !== undefined ? EDIT.draft[name] : row[name];
  const showIf = field.showIf ? ` data-show-if="${esc(field.showIf.field)}" data-show-when="${esc(JSON.stringify(field.showIf.equals))}"` : "";
  return `<div class="field${compact ? " compact" : ""}" data-field-row="${esc(name)}"${showIf}>
    <div class="field-label">
      <span class="name">${esc(field.label)}</span>
      <span class="col">${esc(name)}</span>
    </div>
    <div>${fieldControl(field, value)}</div>
    ${field.help ? `<div class="field-help">${esc(field.help)}</div>` : ""}
  </div>`;
}

// Consecutive fields sharing a `row` key are laid out on one compact row.
function renderFields(spec, row, names) {
  const out = [];
  let i = 0;
  while (i < names.length) {
    const rowKey = spec.fields[names[i]].row;
    if (!rowKey) {
      out.push(renderField(spec, row, names[i]));
      i += 1;
      continue;
    }
    const group = [];
    while (i < names.length && spec.fields[names[i]].row === rowKey) {
      group.push(names[i]);
      i += 1;
    }
    out.push(
      `<div class="field-row cols-${group.length}">${group.map((n) => renderField(spec, row, n, true)).join("")}</div>`,
    );
  }
  return out.join("");
}

// Hide fields whose showIf condition isn't met, using the live draft value so
// switching a toggle reveals/hides its dependants immediately.
function applyConditionalVisibility() {
  if (!EDIT) return;
  for (const el of document.querySelectorAll("[data-show-if]")) {
    const dep = el.dataset.showIf;
    const want = JSON.parse(el.dataset.showWhen);
    const current = EDIT.draft[dep] !== undefined ? EDIT.draft[dep] : EDIT.row[dep];
    const hide = JSON.stringify(current ?? null) !== JSON.stringify(want);
    el.hidden = hide;
    // A field you can't see must not be saved: drop any staged edit and put
    // the control back to the stored value.
    const name = el.dataset.fieldRow;
    if (hide && EDIT.draft[name] !== undefined) {
      delete EDIT.draft[name];
      const ctrl = el.querySelector("[data-field]");
      if (ctrl) {
        const stored = EDIT.row[name];
        if (ctrl.type === "checkbox") ctrl.checked = stored === true;
        else ctrl.value = stored ?? "";
      }
    }
  }
}

function readControl(field, el) {
  if (field.widget === "multi" || field.type === "array") {
    const box = el.closest("[data-multi]") || el;
    return [...box.querySelectorAll("input[type=checkbox]")].filter((b) => b.checked).map((b) => b.value);
  }
  if (field.widget === "toggle") return el.checked;
  const v = el.value.trim();
  if (v === "") return null;
  if (field.widget === "number") return Number(v);
  return v;
}

function currentChanges() {
  const spec = SCHEMA[EDIT.usecase];
  const out = {};
  for (const [name, value] of Object.entries(EDIT.draft)) {
    const before = EDIT.row[name] ?? null;
    const after = value ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) out[name] = { from: before, to: after, label: spec.fields[name].label };
  }
  return out;
}

function updateDirty() {
  const changes = currentChanges();
  const n = Object.keys(changes).length;
  const el = $("#editor-dirty");
  el.textContent = n ? `${n} unsaved change${n === 1 ? "" : "s"}` : "No changes";
  el.classList.toggle("dirty", n > 0);
  $("#editor-save").disabled = n === 0;
  $("#editor-reset").disabled = n === 0;
  for (const row of document.querySelectorAll("[data-field-row]")) {
    row.classList.toggle("changed", Boolean(changes[row.dataset.fieldRow]));
  }
}

$("#editor-body").addEventListener("input", (e) => {
  const el = e.target.closest("[data-field]");
  if (!el || !EDIT) return;
  const name = el.dataset.field;
  if (!SCHEMA[EDIT.usecase].fields[name]) return;
  const field = SCHEMA[EDIT.usecase].fields[name];
  EDIT.draft[name] = readControl(field, el);
  if (field.widget === "toggle") {
    const state = el.closest(".switch").querySelector(".state");
    if (state) state.textContent = el.checked ? "on" : "off";
    applyConditionalVisibility();
  }
  updateDirty();
});

async function openEditor(usecase, projectCode) {
  try {
    await loadSchema();
  } catch (err) {
    return toast("Could not load schema: " + err.message, "err");
  }
  const list = Array.isArray(DATA[usecase]) ? DATA[usecase] : [];
  const row = list.find((r) => String(rowId(usecase, r)) === String(projectCode));
  if (!row) return toast(`${projectCode} not found — try Refresh`, "err");
  EDIT = { usecase, projectCode, row, draft: {} };
  editorEl.hidden = false;
  scrimEl.hidden = false;
  renderEditor();
}

function closeEditor(force = false) {
  if (!EDIT) return;
  if (!force && Object.keys(currentChanges()).length && !confirm("Discard unsaved changes?")) return;
  EDIT = null;
  editorEl.hidden = true;
  scrimEl.hidden = true;
}

$("#editor-close").addEventListener("click", () => closeEditor());
scrimEl.addEventListener("click", () => closeEditor());
$("#editor-reset").addEventListener("click", () => {
  EDIT.draft = {};
  renderEditor();
});

// ---------- confirm + save ----------
function diffHtml(changes) {
  return Object.entries(changes).map(([name, c]) => `
    <div class="diff-row">
      <b>${esc(c.label || name)}</b> <code>${esc(name)}</code><br>
      <span class="diff-from">${esc(displayValue(c.from))}</span>
      →
      <span class="diff-to">${esc(displayValue(c.to))}</span>
    </div>`).join("");
}

$("#editor-save").addEventListener("click", () => {
  const changes = currentChanges();
  if (!Object.keys(changes).length) return;
  $("#confirm-diff").innerHTML = diffHtml(changes);
  $("#confirm-note").value = "";
  $("#confirm").hidden = false;
  $("#confirm-note").focus();
});

$("#confirm-cancel").addEventListener("click", () => { $("#confirm").hidden = true; });

$("#confirm-apply").addEventListener("click", async () => {
  const changes = currentChanges();
  const payload = {
    changes: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])),
    baseUpdatedAt: EDIT.row.updated_at || null,
    note: $("#confirm-note").value.trim(),
  };
  $("#confirm-apply").disabled = true;
  try {
    const res = await fetch(`/api/config/${EDIT.usecase}/${encodeURIComponent(EDIT.projectCode)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) {
      toast(body.error + (body.rejected ? ` — ${body.rejected.join("; ")}` : ""), "err");
      if (res.status === 409 && body.current) {
        EDIT.row = body.current;
        EDIT.draft = {};
        renderEditor();
      }
      return;
    }
    const n = Object.keys(changes).length;
    toast(`Saved ${n} change${n === 1 ? "" : "s"} to ${EDIT.projectCode}`, "ok");
    EDIT.row = body.row;
    EDIT.draft = {};
    $("#confirm").hidden = true;
    renderEditor();
    await refresh();
  } catch (err) {
    toast("Save failed: " + err.message, "err");
  } finally {
    $("#confirm-apply").disabled = false;
  }
});

// ---------- history ----------
$("#editor-history").addEventListener("click", async () => {
  if (!EDIT) return;
  const res = await fetch(`/api/audit?usecase=${EDIT.usecase}&project=${encodeURIComponent(EDIT.projectCode)}&limit=50`);
  const { entries } = await res.json();
  $("#editor-body").innerHTML = `
    <section class="fieldgroup">
      <h3>Change history — ${esc(EDIT.projectCode)}</h3>
      ${entries.length ? entries.map((e) => `
        <div class="history-entry${e.external ? " external" : ""}">
          <div class="when">${fmtDate(e.at)} · ${e.external
            ? `<b title="No dashboard operator recorded — changed directly in Supabase">⚠️ changed outside the dashboard</b>`
            : esc(e.actor_email || "unknown")}</div>
          ${e.note ? `<div class="note">📝 ${esc(e.note)}</div>` : ""}
          ${Object.entries(e.changes).map(([k, c]) => `
            <div class="diff-row"><code>${esc(k)}</code>
              <span class="diff-from">${esc(displayValue(c.from))}</span> →
              <span class="diff-to">${esc(displayValue(c.to))}</span>
            </div>`).join("")}
        </div>`).join("") : `<p class="empty">No changes recorded yet.</p>`}
      <button class="ghost" id="history-back">← Back to fields</button>
    </section>`;
  $("#history-back").addEventListener("click", renderEditor);
});

// ---------- entry points ----------
cardsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".edit-btn");
  if (!btn) return;
  const card = btn.closest(".card");
  openEditor(card.dataset.usecase, card.dataset.project);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("#confirm").hidden) $("#confirm").hidden = true;
    else closeEditor();
  }
});
