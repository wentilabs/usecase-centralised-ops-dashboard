import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listNoiseSourceProfiles, saveNoiseSourceProfile } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PROFILE_FIELDS: Record<string, { settings: string[]; contexts: string[] }> = {
  default: { settings: ["username", "password"], contexts: ["A", "B", "C", "D"] },
  whgd: { settings: ["username", "password"], contexts: ["main"] },
  svs: { settings: ["username", "password"], contexts: ["main"] },
  egh: { settings: ["username", "password"], contexts: ["main"] },
  geoscan: { settings: ["usernames", "password"], contexts: ["01", "02", "03", "04", "05", "06"] },
  trackmaster: { settings: ["username", "password", "customerId"], contexts: ["main"] },
  alphalab: { settings: ["username", "password"], contexts: ["main"] },
  browserbase: { settings: ["apiKey", "projectId"], contexts: [] },
};

function editorDenied() {
  return NextResponse.json({ error: "Editor access is required to manage Noise source profiles." }, { status: 403 });
}

/** Credential values are returned only to signed-in HALO editors. */
export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.canEdit) return editorDenied();

  try {
    const profiles = await listNoiseSourceProfiles();
    return NextResponse.json(
      { profiles: Object.fromEntries(Object.keys(PROFILE_FIELDS).map((code) => [code, profiles[code] ?? { profile_code: code, settings: {}, contexts: {} }])) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Could not read Noise source profiles." }, { status: 503 });
  }
}

/** Update exactly one allow-listed profile and its own Browserbase contexts. */
export async function PUT(request: NextRequest) {
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
  if (!fields) return NextResponse.json({ error: "Unknown Noise source profile." }, { status: 400 });
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
    if (field === "usernames" && profileCode === "geoscan") {
      if (!Array.isArray(value) || value.length !== 6 || value.some((item) => typeof item !== "string" || item.length > 500)) {
        return NextResponse.json({ error: "GeoScan requires six usernames." }, { status: 400 });
      }
      settings[field] = value.map((item) => (item as string).trim());
      continue;
    }
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
    const profile = await saveNoiseSourceProfile(profileCode, settings, contexts, session.actor);
    return NextResponse.json({ ok: true, profile }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not save Noise source profile." }, { status: 503 });
  }
}
