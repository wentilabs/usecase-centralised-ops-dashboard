"use strict";

/**
 * Config-change history, stored in Postgres (ops.config_audit).
 *
 * The database trigger writes every row — including changes made directly in
 * the Supabase table editor — so history is complete regardless of who or what
 * made the change. After a dashboard write succeeds we annotate the row it
 * produced (matched on the returned updated_at) with the operator's email and
 * note; rows that stay unannotated are external changes, and the UI says so.
 *
 * A local JSONL mirror is kept as a fallback so a Postgres hiccup can never
 * lose the operator's intent.
 */

const fs = require("fs");

const AUDIT_SCHEMA = "ops";
const AUDIT_TABLE = "config_audit";

function makeAuditStore({ supabaseUrl, supabaseKey, mirrorPath, fetchImpl = fetch, timeoutMs = 8000 }) {
  const base = `${String(supabaseUrl).replace(/\/+$/, "")}/rest/v1/${AUDIT_TABLE}`;

  function headers(extra = {}) {
    return {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Accept-Profile": AUDIT_SCHEMA,
      "Content-Profile": AUDIT_SCHEMA,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async function call(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = await res.text();
      return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
    } finally {
      clearTimeout(timer);
    }
  }

  function mirror(entry) {
    if (!mirrorPath) return;
    try {
      fs.appendFileSync(mirrorPath, JSON.stringify(entry) + "\n");
    } catch (error) {
      console.warn(`[audit] local mirror write failed: ${error.message}`);
    }
  }

  // Attach the operator + note to the trigger-created row for this write.
  async function annotate({ tableName, rowId, newUpdatedAt, actorEmail, note, changes, usecase }) {
    const entry = {
      at: new Date().toISOString(),
      usecase,
      table_name: tableName,
      row_id: rowId,
      actor_email: actorEmail || null,
      note: note || "",
      changes,
    };
    mirror(entry);

    if (!newUpdatedAt) return { annotated: false, reason: "no_updated_at" };
    const query =
      `?table_name=eq.${encodeURIComponent(tableName)}` +
      `&row_id=eq.${encodeURIComponent(rowId)}` +
      `&new_updated_at=eq.${encodeURIComponent(newUpdatedAt)}`;
    try {
      const res = await call(`${base}${query}`, {
        method: "PATCH",
        headers: headers({ Prefer: "return=representation" }),
        body: JSON.stringify({ actor_email: actorEmail || null, note: note || null, source: "dashboard" }),
      });
      if (!res.ok) return { annotated: false, reason: `${res.status}` };
      return { annotated: Array.isArray(res.body) && res.body.length > 0 };
    } catch (error) {
      console.warn(`[audit] annotate failed: ${error.message}`);
      return { annotated: false, reason: error.message };
    }
  }

  // Newest first. Filters are optional; `tableName`/`rowId` scope it to one project.
  async function list({ tableName = null, rowId = null, limit = 200 } = {}) {
    const params = [`select=*`, `order=at.desc`, `limit=${Math.min(Number(limit) || 200, 1000)}`];
    if (tableName) params.push(`table_name=eq.${encodeURIComponent(tableName)}`);
    if (rowId) params.push(`row_id=eq.${encodeURIComponent(rowId)}`);
    const res = await call(`${base}?${params.join("&")}`, { headers: headers() });
    if (!res.ok) {
      // 404 = table missing, 406 = schema not exposed to PostgREST. Both mean
      // the same thing to the operator: setup hasn't been run yet.
      const hint =
        res.status === 404 || res.status === 406
          ? "ops.config_audit not reachable — run supabase/config_audit_setup.sql, then add `ops` to Supabase → Settings → API → Exposed schemas."
          : `status ${res.status}`;
      throw new Error(hint);
    }
    return (res.body || []).map((row) => ({
      ...row,
      // An unannotated row was not made through this dashboard.
      external: !row.actor_email,
    }));
  }

  return { annotate, list };
}

module.exports = { makeAuditStore, AUDIT_SCHEMA, AUDIT_TABLE };
