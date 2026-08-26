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
}: {
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
      if (body.proposal) {
        // The sentence travels with the proposal and lands in the audit note, so
        // the trail records what was asked for, not just what changed.
        onProposal({ ...body.proposal, summary: body.proposal.summary });
        setPrompt("");
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
    <div className="flex flex-col gap-1">
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
          placeholder="Ask for a change — “CFC's WBGT alerts shouldn't go out on Sundays”"
          aria-label="Ask for a configuration change"
          className="w-[340px] rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !prompt.trim()}
          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs hover:border-primary disabled:opacity-40"
        >
          {busy ? "Thinking…" : "Propose"}
        </button>
      </div>
      {message ? (
        <p className="max-w-[420px] text-[11px] text-warn" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
