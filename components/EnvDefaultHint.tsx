import type { EnvDefault } from "@/lib/env-defaults";
import { isBlankValue } from "@/lib/env-defaults";

/**
 * The deployment's answer for a column nobody has filled in, and one click to take it.
 *
 * These columns — `lambda_url` and its reply/document siblings — are stored per
 * project but decided per deployment: every non-blank one in the estate is the
 * same URL. Asking someone to retype a 90-character API Gateway address they
 * have no way to remember was never a real question.
 *
 * **Offered, not adopted.** The value is shown as the input's placeholder and
 * is NOT written into the draft, so a row opened for an unrelated edit saves
 * exactly what it saved before. That is the whole reason this is a button and
 * not a silent prefill: a field that LOOKS filled while the column is blank is
 * worse than an empty one, because the blank is at least honest about being
 * blank. A placeholder is greyed and italic-adjacent in every browser, reads as
 * an offer rather than a value, and is never submitted — so the only way this
 * reaches the database is someone pressing "Use this" and then saving, where it
 * appears in the diff and the audit row like any other change.
 *
 * Nothing renders once the column has a value, including a placeholder value
 * like `-`: at that point there is no question to answer, and a permanent
 * "here is a different URL" note under a filled field is just noise.
 */
export function EnvDefaultHint({ envDefault, value, onUse, disabled = false }: {
  envDefault: EnvDefault | null | undefined;
  /** The value as it stands — stored, or already typed in this session. */
  value: unknown;
  /** Adopt it: this writes into the draft, and from there into the diff. */
  onUse: (value: string) => void;
  disabled?: boolean;
}) {
  if (!envDefault || !isBlankValue(value)) return null;

  return (
    <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
      <span>
        Blank. This deployment sends through{" "}
        <span className="font-mono text-[10px] text-primary/80">{envDefault.value}</span>
      </span>
      {disabled ? null : (
        <button
          type="button"
          onClick={() => onUse(envDefault.value)}
          className="rounded border border-primary/40 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10"
        >
          Use this
        </button>
      )}
      {/* The variable name is the half that says where to change it when the
          URL is wrong, which the value alone never tells you. */}
      <span className="font-mono text-[10px] opacity-60">{envDefault.name}</span>
    </p>
  );
}
