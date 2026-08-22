"use client";

import { useState, type ReactNode } from "react";

import {
  fallbackValue,
  previewContext,
  previewsFor,
  type FormatterPreview as Preview,
  type PreviewBubble,
} from "@/lib/message-previews";
import type { ServiceKey } from "@/lib/services";
import { useEscapeKey } from "@/lib/use-body-scroll-lock";

/**
 * "What does this formatter actually send?"
 *
 * Formatter columns are dropdowns of opaque names. Answering that question used
 * to mean opening a service repo's MESSAGE_SHAPES.md, so anyone but the author
 * picked a formatter by guessing. The circled `?` beside the field label opens
 * the real message instead, styled the way it lands in WhatsApp.
 *
 * Options sit in a rail on the left rather than behind tabs: the actual task is
 * comparing two candidates, and flicking between them one click apart is what
 * makes the difference legible.
 *
 * Desktop only for now — the button is hidden below `md`, where the phone
 * editor has no room for a 900px comparison panel.
 */

/** WhatsApp renders `*bold*` and `_italic_`; these services use both and nothing else. */
const WA_MARKUP = /(\*[^*\n]+\*|_[^_\n]+_)/g;

function renderWhatsApp(text: string): ReactNode[] {
  return text.split(WA_MARKUP).map((part, index) => {
    if (/^\*[^*\n]+\*$/.test(part)) {
      return <strong key={index}>{part.slice(1, -1)}</strong>;
    }
    if (/^_[^_\n]+_$/.test(part)) {
      return (
        <em key={index} className="text-[#8696a0]">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

/**
 * One received message.
 *
 * WhatsApp's own dark palette, hard-coded rather than themed: the point is that
 * this looks like WhatsApp and not like the rest of the dashboard, so a reader
 * knows at a glance they are looking at the message and not at more config.
 */
function Bubble({ bubble }: { bubble: PreviewBubble }) {
  return (
    <div>
      {bubble.caption ? (
        <div className="mb-1 text-[10px] uppercase tracking-wider text-[#8696a0]">{bubble.caption}</div>
      ) : null}
      <div className="max-w-[85%] rounded-lg rounded-tl-none bg-[#202c33] px-2.5 py-2 shadow-sm">
        <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.45] text-[#e9edef]">
          {renderWhatsApp(bubble.text)}
        </pre>
      </div>
    </div>
  );
}

/** The quarter-hour firing table, for options that change timing and not text. */
function CadenceTable({ rows }: { rows: NonNullable<Preview["cadence"]> }) {
  return (
    <table className="w-full border-collapse text-left text-xs">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <th className="border-b border-border pb-1 pr-3 font-normal">SGT minute</th>
          <th className="border-b border-border pb-1 font-normal">Sends when</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.when}>
            <td className="border-b border-border/60 py-1.5 pr-3 font-mono text-[11px]">{row.when}</td>
            <td
              className={`border-b border-border/60 py-1.5 ${
                row.fires === "Never" ? "text-muted-foreground" : ""
              }`}
            >
              {row.fires}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PreviewModal({
  service,
  column,
  label,
  current,
  onClose,
  onPick,
}: {
  service: ServiceKey;
  column: string;
  label: string;
  /** The draft value, so the option in force is marked as such. */
  current: string;
  onClose: () => void;
  /** Lets someone act on what they just read, instead of closing and hunting the dropdown. */
  onPick?: (value: string) => void;
}) {
  const options = previewsFor(service, column);
  const context = previewContext(service, column);
  const blankResolvesTo = fallbackValue(service, column);
  // Open on whatever is configured — a blank column opens on what it resolves to.
  const effective = current || blankResolvesTo || options[0]?.value || "";
  const [selected, setSelected] = useState(effective);
  const active = options.find((option) => option.value === selected) ?? options[0];

  useEscapeKey(true, onClose);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[88vh] w-[min(940px,94vw)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold">{label}</h3>
            <div className="font-mono text-[10px] text-muted-foreground">{column}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[248px_1fr]">
          <nav className="min-h-0 overflow-y-auto border-r border-border bg-card/40 p-2">
            {options.map((option) => {
              const isActive = option.value === active.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelected(option.value)}
                  className={`mb-1 w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                    isActive ? "bg-primary/20" : "hover:bg-card"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-mono text-[11px] leading-tight">{option.value}</span>
                    {option.value === current ? (
                      <span className="rounded bg-on/20 px-1 text-[9px] uppercase tracking-wide text-on">
                        in use
                      </span>
                    ) : null}
                    {option.isFallback ? (
                      <span className="rounded bg-muted/40 px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                        default
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-muted-foreground">
                    {option.summary}
                  </div>
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 overflow-y-auto">
            <div className="px-5 py-4">
              {context?.intro ? (
                <p className="mb-3 rounded-lg border border-border bg-card/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  {context.intro}
                </p>
              ) : null}

              <p className="text-[13px] leading-relaxed">{active.summary}</p>

              {!current && active.isFallback ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  This column is blank, so this is what the service uses.
                </p>
              ) : null}

              {active.kind === "cadence" && active.cadence ? (
                <div className="mt-4">
                  <CadenceTable rows={active.cadence} />
                </div>
              ) : null}
            </div>

            {/* The WhatsApp surface: a deliberate visual break from the dashboard,
                so nobody mistakes an example message for another config field. */}
            <div className="border-y border-[#2a3942] bg-[#0b141a]">
              <div className="flex items-center gap-2 border-b border-[#2a3942] bg-[#202c33] px-4 py-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2a3942] text-[11px]">
                  👷
                </div>
                <div>
                  <div className="text-[12px] font-medium leading-tight text-[#e9edef]">Site group</div>
                  <div className="text-[10px] leading-tight text-[#8696a0]">WhatsApp preview</div>
                </div>
              </div>
              <div className="flex flex-col gap-3 px-4 py-4">
                <div className="self-center rounded-md bg-[#182229] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#8696a0]">
                  Today
                </div>
                {(context?.shared ?? []).map((bubble, index) => (
                  <Bubble key={`shared-${index}`} bubble={bubble} />
                ))}
                {active.bubbles.map((bubble, index) => (
                  <Bubble key={index} bubble={bubble} />
                ))}
                {!active.bubbles.length && !context?.shared?.length ? (
                  <div className="text-[12px] text-[#8696a0]">No message body differs for this option.</div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-3">
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                From {active.source}. Readings, meter names and times are example values; the layout is the
                service&apos;s own.
              </p>
              {onPick && active.value !== current ? (
                <button
                  type="button"
                  onClick={() => {
                    onPick(active.value);
                    onClose();
                  }}
                  className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  {/* A blank column already behaves as its default, so offering to
                      "use" it would read as a no-op. Writing it down is still worth
                      doing — it survives a change of default in the service. */}
                  {!current && active.isFallback ? "Set explicitly" : "Use this"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The circled `?` beside a field label. Renders nothing when there is no preview. */
export function FormatterPreviewButton({
  service,
  column,
  label,
  current,
  onPick,
}: {
  service: ServiceKey;
  column: string;
  label: string;
  current: string;
  onPick?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!previewsFor(service, column).length) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`See what ${label} sends to WhatsApp`}
        aria-label={`See what ${label} sends to WhatsApp`}
        className="hidden h-4 w-4 shrink-0 items-center justify-center rounded-full border border-muted-foreground/60 text-[10px] font-semibold leading-none text-muted-foreground transition-colors hover:border-primary hover:text-primary md:inline-flex"
      >
        ?
      </button>
      {open ? (
        <PreviewModal
          service={service}
          column={column}
          label={label}
          current={current}
          onClose={() => setOpen(false)}
          onPick={onPick}
        />
      ) : null}
    </>
  );
}
