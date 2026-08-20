"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { splitList } from "@/lib/card-summary";

/**
 * Chat-id input that reads like the "To:" field of an email client.
 *
 * Chat ids are 18-digit strings nobody can recall, which made the csv textarea
 * unusable on a phone. Here you type a group NAME, pick from the matches, and
 * the selection becomes a pill. What is stored is unchanged: the same
 * comma-separated list of ids, so every alert service keeps parsing it exactly
 * as before.
 *
 * Names come from ops.whatsapp_group_names (see lib/group-names.ts). An id with
 * no stored name still works — it shows as the raw id, and a pasted id is
 * accepted whether or not the listener has ever seen it.
 */

/** Enough to scroll, few enough to stay responsive with ~641 groups stored. */
const MAX_RENDERED = 40;

type Option = { chatId: string; name: string | null };

function looksLikeChatId(value: string) {
  return /@(g\.us|c\.us|lid)$/.test(value.trim());
}

export function GroupPicker({
  value,
  onChange,
  groupNames,
  disabled = false,
}: {
  /** Comma-separated chat ids, exactly as stored in Supabase. */
  value: string;
  onChange: (next: string) => void;
  groupNames: Record<string, string>;
  disabled?: boolean;
}) {
  const selected = useMemo(() => splitList(value), [value]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close when the tap lands outside. Pointerdown rather than blur, so that
  // clicking an option is not cancelled by the input losing focus first.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const matches = useMemo(() => {
    const taken = new Set(selected);
    const needle = query.trim().toLowerCase();
    const all: Option[] = Object.entries(groupNames)
      .filter(([chatId]) => !taken.has(chatId))
      .map(([chatId, name]) => ({ chatId, name }));

    const hits = needle
      ? all.filter((o) => o.name?.toLowerCase().includes(needle) || o.chatId.toLowerCase().includes(needle))
      : all;

    hits.sort((a, b) => (a.name ?? a.chatId).localeCompare(b.name ?? b.chatId));
    return { shown: hits.slice(0, MAX_RENDERED), total: hits.length };
  }, [groupNames, selected, query]);

  // A pasted or hand-typed id that the alias store has never seen is still valid.
  const rawEntry = looksLikeChatId(query) && !selected.includes(query.trim()) ? query.trim() : null;
  const options: Option[] = rawEntry
    ? [{ chatId: rawEntry, name: null }, ...matches.shown.filter((o) => o.chatId !== rawEntry)]
    : matches.shown;

  useEffect(() => {
    setCursor(0);
  }, [query]);

  function commit(next: string[]) {
    // Canonical comma-separated form; every consumer trims, so no space needed.
    onChange([...new Set(next)].join(","));
  }

  function add(chatId: string) {
    if (!chatId) return;
    commit([...selected, chatId]);
    setQuery("");
    setOpen(true);
    inputRef.current?.focus();
  }

  function remove(chatId: string) {
    commit(selected.filter((id) => id !== chatId));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setCursor((c) => {
        if (!options.length) return 0;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return (c + delta + options.length) % options.length;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const pick = options[cursor];
      if (pick) add(pick.chatId);
      else if (looksLikeChatId(query)) add(query.trim());
      return;
    }
    // Comma and Tab finish the current entry, as in an email recipient field.
    if ((event.key === "," || event.key === "Tab") && query.trim()) {
      const pick = options[cursor];
      if (pick || looksLikeChatId(query)) {
        event.preventDefault();
        add(pick ? pick.chatId : query.trim());
      }
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    // Backspace on an empty box removes the last pill, as everywhere else.
    if (event.key === "Backspace" && !query && selected.length) {
      remove(selected[selected.length - 1]);
    }
  }

  const listboxId = "group-picker-list";

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex flex-wrap items-center gap-1.5 rounded-lg border bg-card px-2 py-2 ${
          open ? "border-primary" : "border-border"
        } ${disabled ? "opacity-60" : ""}`}
        onClick={() => !disabled && inputRef.current?.focus()}
      >
        {selected.map((chatId) => (
          <span
            key={chatId}
            className="flex max-w-full items-center gap-1 rounded-full bg-muted py-1 pl-2.5 pr-1 text-xs"
            title={groupNames[chatId] ? `${groupNames[chatId]} · ${chatId}` : chatId}
          >
            <span className="truncate">{groupNames[chatId] ?? chatId}</span>
            {disabled ? null : (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  remove(chatId);
                }}
                aria-label={`Remove ${groupNames[chatId] ?? chatId}`}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-danger/20 hover:text-danger"
              >
                ✕
              </button>
            )}
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          spellCheck={false}
          disabled={disabled}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selected.length ? "Add another…" : "Type a group name…"}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
        />
      </div>

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto overscroll-contain rounded-lg border border-border bg-background shadow-2xl"
        >
          {options.length ? (
            options.map((option, index) => (
              <button
                key={option.chatId}
                type="button"
                role="option"
                aria-selected={index === cursor}
                onPointerEnter={() => setCursor(index)}
                onClick={() => add(option.chatId)}
                className={`flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left ${
                  index === cursor ? "bg-primary/15" : ""
                }`}
              >
                <span className="w-full truncate text-sm">
                  {option.name ?? option.chatId}
                  {option.name === null ? (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      use this id
                    </span>
                  ) : null}
                </span>
                <span className="w-full truncate font-mono text-[10px] text-muted-foreground">{option.chatId}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              {Object.keys(groupNames).length
                ? "No group matches. Paste a chat id ending in @g.us to add it anyway."
                : "No group names stored yet — run `npm run groups:backfill`, or use ⟳ Chat aliases."}
            </p>
          )}

          {matches.total > options.length ? (
            <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              {matches.total - options.length} more — keep typing to narrow it down.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
