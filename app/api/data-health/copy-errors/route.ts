import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  listConfigs,
  listEstateHealth,
  listFrequentRunEvidence,
  listHazeHourlyEvidence,
  listNoiseScheduleEvidence,
  listProjectFaults,
  listProjectStrips,
  listServiceNotices,
  listServiceScheduleEvidence,
  listSubconScheduleEvidence,
} from "@/lib/config-repository";
import { formatCopyErrorsReport } from "@/lib/copy-errors";
import { listHandlerFailures } from "@/lib/handler-failure-repository";
import { boardEntries, deliveryEntries, faultEntries, noticeEntries, summarise } from "@/lib/health-board";
import { missingFrequentRunEntries, missingHazeHourlyEntries } from "@/lib/scheduled-run-health";
import { missingNoiseScheduleEntries } from "@/lib/noise-schedule-health";
import { missingSubconScheduleEntries } from "@/lib/subcon-schedule-health";
import { missingServiceScheduleEntries } from "@/lib/service-schedule-health";
import { boardSignalFor } from "@/lib/process-log";
import { healthKey, type ProjectHealth } from "@/lib/data-health";
import { SERVICE_KEYS, type ServiceKey } from "@/lib/services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: NextRequest): boolean {
  const expected = process.env.HALO_DAILY_ERROR_REPORT_TOKEN ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (expected.length < 32 || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

/** GET /api/data-health/copy-errors — the exact plain-text payload of HALO's Copy errors button. */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const configsPromise = Promise.all(SERVICE_KEYS.map(async (service) => [service, await listConfigs(service)] as const));
  const [configsResult, healthResult, stripsResult, faultsResult, noticesResult, handlerResult, hazeResult, frequentResult, noiseScheduleResult, subconScheduleResult, serviceScheduleResult] = await Promise.allSettled([
    configsPromise,
    listEstateHealth(),
    listProjectStrips(),
    listProjectFaults(),
    listServiceNotices(),
    listHandlerFailures(),
    listHazeHourlyEvidence(),
    listFrequentRunEvidence(),
    listNoiseScheduleEvidence(),
    listSubconScheduleEvidence(),
    listServiceScheduleEvidence(),
  ]);

  // These three inputs define the report's core findings. Never turn a failed read into an empty,
  // apparently healthy report. The other readers encode their own coverage state and remain visible.
  if (configsResult.status === "rejected" || healthResult.status === "rejected" || stripsResult.status === "rejected") {
    return NextResponse.json({ error: "HALO could not read the core Data Health report sources." }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const rows = Object.fromEntries(configsResult.value) as Partial<Record<ServiceKey, Awaited<ReturnType<typeof listConfigs>>>>;
  const health = healthResult.value;
  const strips = stripsResult.value;
  const faults = faultsResult.status === "fulfilled" ? faultsResult.value : {};
  const notices = noticesResult.status === "fulfilled" ? noticesResult.value : [];
  const healthByProject = new Map(health.map((item: ProjectHealth) => [healthKey(item.service, item.projectCode), item]));
  const haze = hazeResult.status === "fulfilled" ? hazeResult.value : null;
  const frequent = frequentResult.status === "fulfilled" ? frequentResult.value : null;
  const noiseSchedules = noiseScheduleResult.status === "fulfilled" ? noiseScheduleResult.value : null;
  const subconSchedules = subconScheduleResult.status === "fulfilled" ? subconScheduleResult.value : null;
  const serviceSchedules = serviceScheduleResult.status === "fulfilled" ? serviceScheduleResult.value : null;
  const summary = summarise([
    ...boardEntries(rows, healthByProject),
    ...deliveryEntries(strips, boardSignalFor),
    ...faultEntries(faults),
    ...noticeEntries(notices),
    ...missingHazeHourlyEntries(rows.haze ?? [], haze),
    ...missingFrequentRunEntries(rows, frequent),
    ...missingNoiseScheduleEntries(noiseSchedules),
    ...missingSubconScheduleEntries(subconSchedules),
    ...missingServiceScheduleEntries(serviceSchedules),
  ]);

  const handlerReport = handlerResult.status === "fulfilled" ? handlerResult.value : null;
  const report = formatCopyErrorsReport({
    summary,
    strips,
    handlerReport,
    handlerReadState: handlerReport ? "ready" : "unavailable",
  });
  return new NextResponse(report, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-HALO-Checked-At": new Date().toISOString(),
    },
  });
}
