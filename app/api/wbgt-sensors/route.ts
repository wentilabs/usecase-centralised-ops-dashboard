import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { annotateAudit, getConfig, getWbgtSensor, listWbgtSensors, renameWbgtSensorLabel, renameWbgtSensorLabelDirect } from "@/lib/config-repository";
import { describePostgrestError } from "@/lib/postgrest-error";
import { getDashboardSession } from "@/lib/supabase/server";
import { validateWbgtSensorLabel } from "@/lib/wbgt-sensor-label";

export const dynamic = "force-dynamic";

/** GET /api/wbgt-sensors — list active sensors for WBGT editors. */

export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectCode = request.nextUrl.searchParams.get("project")?.trim();
  if (!projectCode) return NextResponse.json({ error: "project is required" }, { status: 400 });
  try {
    const sensors = await listWbgtSensors(projectCode);
    return NextResponse.json({ projectCode, sensors }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

/** PATCH /api/wbgt-sensors — rename one active sensor without changing project configuration. */
export async function PATCH(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.canEdit) {
    return NextResponse.json({ error: "Your account has read-only access to the dashboard." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    projectCode?: unknown;
    id?: unknown;
    sensorLabel?: unknown;
    baseSensorLabel?: unknown;
    note?: unknown;
  };
  const projectCode = typeof body.projectCode === "string" ? body.projectCode.trim() : "";
  const id = Number(body.id);
  if (!/^[A-Z0-9_-]{1,24}$/.test(projectCode)) {
    return NextResponse.json({ error: "A valid projectCode is required." }, { status: 400 });
  }
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "A valid sensor id is required." }, { status: 400 });
  }
  const label = validateWbgtSensorLabel(body.sensorLabel);
  if (!label.ok) return NextResponse.json({ error: label.error }, { status: 400 });
  const baseSensorLabel = typeof body.baseSensorLabel === "string" ? body.baseSensorLabel : "";
  if (!validateWbgtSensorLabel(baseSensorLabel).ok) {
    return NextResponse.json({ error: "Reload the sensor before saving; its current label is missing." }, { status: 400 });
  }

  try {
    if (body.sensorLabel === body.baseSensorLabel) {
      return NextResponse.json({ ok: true, unchanged: true }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const config = await getConfig("wbgt", projectCode);
    if (!config) return NextResponse.json({ error: `WBGT project ${projectCode} was not found.` }, { status: 404 });
    const rawMappings = config.sensor_delivery_groups;
    const mappings = rawMappings && typeof rawMappings === "object" && !Array.isArray(rawMappings)
      ? rawMappings as Record<string, unknown>
      : {};
    const newSensorLabel = body.sensorLabel as string;
    const mappingTouchesRename = baseSensorLabel in mappings || newSensorLabel in mappings;

    let after;
    let updatedConfig: Record<string, unknown> | null = null;
    let configUpdatedAt: string | null = null;
    if (mappingTouchesRename) {
      // A mapped MBS sensor needs the optional transactional function so its
      // label and delivery key cannot be left out of sync.
      const current = await getWbgtSensor(projectCode, id);
      if (!current) return NextResponse.json({ error: "Active sensor not found." }, { status: 404 });
      if (current.sensorLabel !== baseSensorLabel) {
        return NextResponse.json({ error: "This sensor changed since you opened it. Reload and re-apply your label.", current }, { status: 409 });
      }
      const result = await renameWbgtSensorLabel({
        projectCode,
        id,
        sensorLabel: newSensorLabel,
        baseUpdatedAt: current.updatedAt,
      });
      if (result.status === "not_found") return NextResponse.json({ error: "Active sensor not found." }, { status: 404 });
      if (result.status === "conflict") return NextResponse.json({ error: "This sensor changed since you opened it. Reload and re-apply your label.", current: result.sensor }, { status: 409 });
      if (result.status === "mapping_conflict") return NextResponse.json({ error: "The new label already has an MBS WhatsApp group mapping. Resolve that mapping before renaming this sensor." }, { status: 409 });
      if (result.status === "unchanged") return NextResponse.json({ ok: true, unchanged: true, sensor: result.sensor }, { headers: { "Cache-Control": "private, no-store" } });
      if (!result.sensor) throw new Error("The database rename returned no sensor row.");
      after = result.sensor;
      updatedConfig = result.config ?? null;
      configUpdatedAt = result.configUpdatedAt ?? null;
    } else {
      const rows = await renameWbgtSensorLabelDirect({
        projectCode,
        id,
        baseSensorLabel,
        sensorLabel: newSensorLabel,
      });
      if (!rows.length) {
        const current = (await listWbgtSensors(projectCode)).find((sensor) => sensor.id === id) ?? null;
        return NextResponse.json(
          { error: current ? "This sensor changed since you opened it. Reload and re-apply your label." : "Active sensor not found.", current },
          { status: current ? 409 : 404 },
        );
      }
      after = rows[0];
    }

    const note = (typeof body.note === "string" && body.note.trim()
      ? body.note.trim()
      : `Set WBGT sensor label to ${after.sensorLabel}`).slice(0, 500);
    const sensorAudit = after.updatedAt ? await annotateAudit({
      table: "wbgt_sensors",
      rowId: String(id),
      newUpdatedAt: after.updatedAt,
      actorEmail: session.actor,
      note,
    }) : { annotated: false, reason: "audit_migration_not_applied" };
    const configAudit = configUpdatedAt ? await annotateAudit({
      table: "wbgt_project_configs",
      rowId: projectCode,
      newUpdatedAt: configUpdatedAt,
      actorEmail: session.actor,
      note,
    }) : null;
    return NextResponse.json({ ok: true, sensor: after, config: updatedConfig, audit: { sensor: sensorAudit, config: configAudit } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = describePostgrestError(error);
    if (/updated_at.*(does not exist|column)|PGRST202/i.test(message)) {
      return NextResponse.json({ error: "This sensor has an MBS group mapping and needs the optional WBGT sensor-label SQL setup before it can be renamed safely." }, { status: 409 });
    }
    if (message.includes("23505") || /unique constraint/i.test(message)) {
      return NextResponse.json({ error: "That label is already used by another sensor in this project." }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
