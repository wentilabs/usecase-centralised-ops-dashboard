import type { ReactNode } from "react";

import { WINDOWS, sgtInputToMs, sgtInputValue, type WindowKey } from "@/lib/lightning-map";
import type { ProjectConfigRow } from "@/lib/services";

export function LightningMapHeader({
  sited,
  focusCode,
  focusOn,
  anchor,
  viewTo,
  setAnchor,
  windowKey,
  setWindowKey,
  refresh,
  zoomControl,
  onClose,
}: {
  sited: ProjectConfigRow[];
  focusCode: string | null;
  focusOn: (project: ProjectConfigRow | null) => void;
  anchor: number | null;
  viewTo?: number;
  setAnchor: (value: number | null) => void;
  windowKey: WindowKey;
  setWindowKey: (value: WindowKey) => void;
  refresh: () => void;
  zoomControl: ReactNode;
  onClose: () => void;
}) {
  return (
    <header className="shrink-0 border-b border-border px-3 pb-2 pt-safe md:flex md:flex-wrap md:items-center md:gap-2 md:px-4 md:py-2">
      <div className="flex items-center gap-2 md:mr-auto md:contents">
        <div className="mr-auto flex items-baseline gap-2 md:mr-auto">
          <h2 className="text-sm font-semibold">Singapore lightning map</h2>
          <span className="hidden text-[11px] text-muted-foreground lg:inline">
            NEA detections, by the time they reached us
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-9 shrink-0 rounded-lg border border-border px-3 text-xs hover:border-danger hover:text-danger md:order-last md:h-8"
        >
          Close
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2 md:mt-0 md:contents">
        <select
          value={focusCode ?? ""}
          onChange={(event) => {
            const code = event.target.value;
            focusOn(code ? (sited.find((row) => row.project_code === code) ?? null) : null);
          }}
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-xs md:h-8 md:flex-none"
        >
          <option value="">All {sited.length} projects</option>
          {sited.map((row) => (
            <option key={String(row.project_code)} value={String(row.project_code)}>
              {String(row.project_code)}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={sgtInputValue(anchor ?? viewTo ?? Date.now())}
          onChange={(event) => setAnchor(sgtInputToMs(event.target.value))}
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-xs md:h-8 md:flex-none"
          aria-label="End of window, Singapore time"
        />
      </div>

      <div className="mt-2 flex items-center gap-2 md:mt-0 md:contents">
        <div className="flex flex-1 overflow-hidden rounded-lg border border-border md:flex-none">
          {WINDOWS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setWindowKey(entry.key)}
              className={`flex-1 px-2.5 py-2 text-xs md:flex-none md:py-1.5 ${
                windowKey === entry.key ? "bg-primary/20 text-primary" : "hover:bg-muted/40"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setAnchor(null);
            refresh();
          }}
          className={`h-9 shrink-0 rounded-lg border px-3 text-xs md:h-8 md:px-2.5 ${
            anchor === null
              ? "border-on/40 bg-on/10 text-on"
              : "border-border bg-card hover:border-primary hover:text-primary"
          }`}
          title={anchor === null ? "Following the clock, refreshing every minute" : "Jump back to now"}
        >
          {anchor === null ? "● Live" : "Now"}
        </button>
        <div className="hidden shrink-0 items-center gap-1 md:flex">{zoomControl}</div>
      </div>
    </header>
  );
}
