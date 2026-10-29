"use client";

import { useEffect, useState } from "react";

const PROFILE_LABELS: Record<string, string> = {
  default: "NoiseLynx · Default",
  whgd: "NoiseLynx · WHGD",
  svs: "NoiseLynx · SVS",
  pentaocean: "NoiseLynx · Pentaocean",
  browserbase: "Shared Browserbase settings",
};

const PROFILE_FIELDS: Record<string, { settings: string[]; contexts: string[] }> = {
  default: { settings: ["username", "password"], contexts: ["main"] },
  whgd: { settings: ["username", "password"], contexts: ["main"] },
  svs: { settings: ["username", "password"], contexts: ["main"] },
  pentaocean: { settings: ["username", "password"], contexts: ["main"] },
  browserbase: { settings: ["apiKey", "projectId"], contexts: [] },
};

const FIELD_LABELS: Record<string, string> = {
  username: "Username",
  password: "Password",
  apiKey: "Browserbase API key",
  projectId: "Browserbase project ID",
};

type StoredProfile = { settings?: Record<string, unknown>; contexts?: Record<string, unknown> };
type ProfileMap = Record<string, StoredProfile>;

export function WbgtSourceProfilesPanel() {
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [selected, setSelected] = useState("default");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [contexts, setContexts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const profileFields = PROFILE_FIELDS[selected];

  useEffect(() => {
    let active = true;
    fetch("/api/wbgt/source-profiles", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load WBGT profiles.");
        if (active) setProfiles(body.profiles ?? {});
      })
      .catch((error: unknown) => {
        if (active) setNotice(error instanceof Error ? error.message : "Could not load WBGT profiles.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const profile = profiles[selected] ?? {};
    const savedSettings = profile.settings ?? {};
    setSettings(Object.fromEntries(profileFields.settings.map((field) => [
      field,
      typeof savedSettings[field] === "string" ? savedSettings[field] as string : "",
    ])));
    const savedContexts = profile.contexts ?? {};
    setContexts(Object.fromEntries(profileFields.contexts.map((key) => [key, String(savedContexts[key] ?? "")])));
    setNotice("");
  }, [profiles, selected]);

  async function save() {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/wbgt/source-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileCode: selected, settings, contexts }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save profile.");
      setProfiles((current) => ({ ...current, [selected]: body.profile }));
      setNotice("Saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">WBGT source profiles</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            These records live in WBGT and are read and written by the WBGT service. HALO edits them through the
            token-protected WBGT API; anonymous database access is revoked.
          </p>
        </div>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Profile
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="min-w-56 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {Object.entries(PROFILE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {loading ? <p className="mt-4 text-sm text-muted-foreground">Loading profiles…</p> : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {profileFields.settings.map((field) => (
              <label key={field} className="grid gap-1 text-xs font-medium text-muted-foreground">
                {FIELD_LABELS[field] ?? field}
                <input
                  type={field.toLowerCase().includes("password") || field === "apiKey" ? "password" : "text"}
                  value={settings[field] ?? ""}
                  onChange={(event) => setSettings((current) => ({ ...current, [field]: event.target.value }))}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  autoComplete="new-password"
                />
              </label>
            ))}
          </div>

          {profileFields.contexts.length ? (
            <fieldset className="mt-4 grid gap-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">Browserbase context ID</legend>
              {profileFields.contexts.map((key) => (
                <label key={key} className="grid gap-1 text-xs text-muted-foreground">
                  Context
                  <input
                    value={contexts[key] ?? ""}
                    onChange={(event) => setContexts((current) => ({ ...current, [key]: event.target.value }))}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                    autoComplete="off"
                  />
                </label>
              ))}
            </fieldset>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
            <span aria-live="polite" className="text-sm text-muted-foreground">{notice}</span>
          </div>
        </>
      )}
    </section>
  );
}
