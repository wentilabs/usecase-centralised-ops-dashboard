"use client";

import { useState } from "react";

/**
 * One line of chat that proposes a configuration change.
 *
 * Deliberately not a chat *window*. There is no transcript, no history and no
 * second UI for reviewing what it suggested — a sentence in, and either an answer
 * in words or the ordinary editor opening with those fields already changed. The
 * confirmation someone gives is the same diff and the same save they would use by
 * hand, which is the only way this stays trustworthy.
 *
 * It refuses more often than it acts, and that is the intended feel: no project
 * named, two projects named, or an outcome no column covers all come back as a
 * question rather than a guess.
 */
export function SmartChat({
  onProposal,
  onBatch,
  fullWidth = false,
}: {
  /** Stretch to the container. The mobile row is full width; the header is not. */
  fullWidth?: boolean;
  /**
   * A change covering several projects, which cannot open the single-row editor
   * and gets its own review list instead. The sentence travels with it for the
   * same reason it travels with a single proposal — every row's audit note.
   */
  onBatch: (batch: { scope: string; summary: string; matchedGroups?: unknown[]; edits: unknown[] }, prompt: string) => void;
  onProposal: (proposal: {
    service: string;
    projectCode: string;
    rowId: string;
    changes: Record<string, unknown>;
    summary: string;
    rejected: { column: string; reason: string }[];
  }) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    const asked = prompt.trim();
    if (!asked || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: asked }),
      });
      const body = await res.json();
      if (body.batch) {
        onBatch(body.batch, asked);
        setMessage(null);
        return;
      }
      if (body.proposal) {
        // The sentence travels with the proposal and lands in the audit note, so
        // the trail records what was asked for, not just what changed.
        onProposal({ ...body.proposal, summary: body.proposal.summary });
        // The prompt STAYS. A proposal is usually the first draft of a request —
        // one radius wrong, or the wrong project — and retyping the whole
        // sentence to change a digit is the kind of small hostility that stops
        // people using a thing. Clear it yourself when you are done with it.
        setMessage(null);
        return;
      }
      setMessage(body.message ?? `HTTP ${res.status}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-1 ${fullWidth ? "w-full" : ""}`}>
      <div className="flex items-center gap-2">
        <input
          value={prompt}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={fullWidth ? "Ask for a change — “TJR lightning, amber off”" : "Ask for a change — “CFC's WBGT alerts shouldn't go out on Sundays”"}
          aria-label="Ask for a configuration change"
          className={`rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary disabled:opacity-60 ${
            // Taller on the phone row, where it is a thumb target rather than one
            // control among many in a dense header.
            fullWidth ? "min-w-0 flex-1 py-2.5" : "w-[340px] py-1.5"
          }`}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !prompt.trim()}
          className={`shrink-0 rounded-lg border border-border bg-card px-2.5 text-xs hover:border-primary disabled:opacity-40 ${
            fullWidth ? "py-2.5" : "py-1.5"
          }`}
        >
          {busy ? "Thinking…" : "Propose"}
        </button>
      </div>
      {message ? (
        <p className={`text-[11px] text-warn ${fullWidth ? "" : "max-w-[420px]"}`} role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
