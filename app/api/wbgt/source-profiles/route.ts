import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listWbgtSourceProfiles, saveWbgtSourceProfile } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PROFILE_FIELDS: Record<string, { settings: string[]; contexts: string[] }> = {
  default: { settings: ["username", "password"], contexts: ["main"] },
  whgd: { settings: ["username", "password"], contexts: ["main"] },
  svs: { settings: ["username", "password"], contexts: ["main"] },
  pentaocean: { settings: ["username", "password"], contexts: ["main"] },
  browserbase: { settings: ["apiKey", "projectId"], contexts: [] },
};

function editorDenied() {
  return NextResponse.json({ error: "Editor access is required to manage WBGT source profiles." }, { status: 403 });
}

export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.canEdit) return editorDenied();

  try {
    const profiles = await listWbgtSourceProfiles();
    return NextResponse.json(
      { profiles: Object.fromEntries(Object.keys(PROFILE_FIELDS).map((code) => [code, profiles[code] ?? { profile_code: code, settings: {}, contexts: {} }])) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Could not read WBGT source profiles." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.canEdit) return editorDenied();

  const body = (await request.json().catch(() => ({}))) as {
    profileCode?: unknown;
    settings?: unknown;
    contexts?: unknown;
  };
  const profileCode = String(body.profileCode ?? "");
  const fields = PROFILE_FIELDS[profileCode];
  if (!fields) return NextResponse.json({ error: "Unknown WBGT source profile." }, { status: 400 });
  if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings) ||
      !body.contexts || typeof body.contexts !== "object" || Array.isArray(body.contexts)) {
    return NextResponse.json({ error: "Settings and contexts must be objects." }, { status: 400 });
  }

  const incomingSettings = body.settings as Record<string, unknown>;
  const incomingContexts = body.contexts as Record<string, unknown>;
  const settings: Record<string, unknown> = {};
  const contexts: Record<string, unknown> = {};
  for (const field of fields.settings) {
    const value = incomingSettings[field];
    if (typeof value !== "string" || value.length > 2000) {
      return NextResponse.json({ error: `Invalid ${field} value.` }, { status: 400 });
    }
    settings[field] = value.trim();
  }
  for (const key of fields.contexts) {
    const value = incomingContexts[key] ?? "";
    if (typeof value !== "string" || value.length > 500) {
      return NextResponse.json({ error: `Invalid Browserbase context for ${key}.` }, { status: 400 });
    }
    if (value.trim()) contexts[key] = value.trim();
  }

  try {
    const profile = await saveWbgtSourceProfile(profileCode, settings, contexts, session.actor);
    return NextResponse.json({ ok: true, profile }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not save WBGT source profile." }, { status: 503 });
  }
}
