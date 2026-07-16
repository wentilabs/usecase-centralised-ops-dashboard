"use strict";

// ---------- state ----------
let DATA = { wbgt: [], noise: [], headerLinks: { wbgt: {}, noise: {} } };
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
  if (c.enable_intermittent_reports) parts.push("<b>:30</b> if Moderate+, <b>:15/:45</b> if High");
  if (!parts.length) return "No cadences enabled";
  let s = parts.join(" · ") + ` — site hours <b>${esc(c.site_hours_start)}:00–${esc(c.site_hours_end)}:00</b>`;
  if (c.skip_lunch_hour) s += ", skips 12:00";
  if (c.remove_sunday_notifications) s += ", muted Sundays";
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
  if (c.three_hour_formatter) parts.push(`<b>3-hr summary</b>`);
  if (c.morning_formatter) parts.push(`<b>morning</b>${c.morning_summary_start_hhmm ? ` @ ${fmtHHMM(c.morning_summary_start_hhmm)}` : ""}`);
  if (!parts.length) return "No cadences enabled";
  let s = parts.join(" · ");
  if (c.remove_sunday_notifications) s += " — muted Sundays";
  return s;
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
  if (usecase === "wbgt") {
    if (c.monthly_sheet_id) out.push(linkBtn("📗 Monthly sheet", sheetUrl(c.monthly_sheet_id)));
  } else {
    if (c.google_sheet_id) out.push(linkBtn("📗 Analysis sheet", sheetUrl(c.google_sheet_id)));
  }
  if (c.debug_google_sheet_id) out.push(linkBtn("🐛 Debug sheet", sheetUrl(c.debug_google_sheet_id)));
  if (c.lambda_url) out.push(linkBtn("λ Lambda proxy", c.lambda_url));
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

function cardWBGT(c) {
  return `
    <div class="pills">
      ${pill("hourly", c.enable_hourly)}
      ${pill("intermittent", c.enable_intermittent_reports)}
      ${pill("5-min alerts", c.enable_5min_alerts)}
      ${pill("skip lunch", c.skip_lunch_hour)}
      ${pill("mute Sundays", c.remove_sunday_notifications)}
    </div>
    <div>
      <div class="section-label">Fires at</div>
      <div class="fires">${wbgtFires(c)}</div>
    </div>
    <div>
      <div class="section-label">WhatsApp</div>
      <div class="chips">${whatsappChips(c)}</div>
    </div>
    ${c.top_of_hour_band ? `<div class="fires">Current band: <b>${esc(c.top_of_hour_band)}</b></div>` : ""}
    ${c.enable_5min_alerts && c.last_5min_alert_level ? `<div class="fires">5-min alert zone: <b>${esc(c.last_5min_alert_level)}</b></div>` : ""}
  `;
}

function cardNoise(c) {
  return `
    <div class="pills">
      ${pill("5-min", c.enable_5min)}
      ${pill("half-hourly", c.enable_half_hourly)}
      ${pill("hourly", c.enable_hourly)}
      ${pill("3-hr summary", c.three_hour_formatter)}
      ${pill("morning summary", c.morning_formatter)}
      ${pill("mute Sundays", c.remove_sunday_notifications)}
    </div>
    <div>
      <div class="section-label">Message formats</div>
      <div class="chips">
        <span class="chip"><span class="chip-k">5min</span> ${esc(c.five_min_formatter)}</span>
        <span class="chip"><span class="chip-k">½hr</span> ${esc(c.half_hourly_formatter)}</span>
        <span class="chip"><span class="chip-k">1hr</span> ${esc(c.hourly_formatter)}</span>
        ${c.three_hour_formatter ? `<span class="chip"><span class="chip-k">3hr</span> ${esc(c.three_hour_formatter)}</span>` : ""}
        ${c.morning_formatter ? `<span class="chip"><span class="chip-k">am</span> ${esc(c.morning_formatter)}</span>` : ""}
      </div>
    </div>
    <div>
      <div class="section-label">Fires at</div>
      <div class="fires">${noiseFires(c)}</div>
    </div>
    <div>
      <div class="section-label">WhatsApp</div>
      <div class="chips">${whatsappChips(c)}</div>
    </div>
  `;
}

function hasCadence(usecase, c) {
  return usecase === "wbgt"
    ? Boolean(c.enable_hourly || c.enable_intermittent_reports || c.enable_5min_alerts)
    : Boolean(c.enable_5min || c.enable_half_hourly || c.enable_hourly || c.three_hour_formatter || c.morning_formatter);
}

function renderCard(usecase, c) {
  const links = [...autoLinks(usecase, c), ...manualLinks(usecase, c)];
  const cls = [c.enabled ? "" : "disabled", hasCadence(usecase, c) ? "" : "nocad"].join(" ");
  return `
  <article class="card ${cls}" data-usecase="${usecase}" data-project="${esc(c.project_code)}">
    <h2>
      <span class="usecase-tag ${usecase}">${usecase === "wbgt" ? "WBGT" : "NOISE"}</span>
      ${esc(c.project_code)}
      <span class="enabled-badge ${c.enabled ? "on" : "off"}">${c.enabled ? "● ENABLED" : "○ DISABLED"}</span>
    </h2>
    ${usecase === "wbgt" ? cardWBGT(c) : cardNoise(c)}
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

function render() {
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
async function refresh() {
  statusEl.textContent = "Loading…";
  try {
    const res = await fetch("/api/projects");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.status);
    DATA = body;
    const count = (u) => (Array.isArray(body[u]) ? body[u].length : 0);
    statusEl.textContent = `${count("wbgt")} WBGT · ${count("noise")} Noise · fetched ${fmtDate(body.fetchedAt)}`;
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

refresh();
