import { helpSegments } from "@/lib/help-text";

/**
 * Explanatory text with its literal values marked.
 *
 * The strings in `lib/field-spec` and `lib/onboarding` quote values the reader
 * has to type or match exactly — a format like `HH00,lookback`, a sheet tab
 * called `Manpower`, an enum value — using backticks. React renders a string
 * verbatim, so without this they arrive on screen as backtick characters.
 *
 * One component rather than the same six lines in each place: the editor's
 * field help, the onboarding field help, and the two "still to do" checklists
 * all render the same kind of string, and a fourth caller should not have to
 * rediscover that.
 */
export function HelpText({ text }: { text: string }) {
  return (
    <>
      {helpSegments(text).map((segment, index) =>
        segment.code ? (
          <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">
            {segment.text}
          </code>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
