/**
 * The reconstruction reads all seven services and clusters them before it can
 * draw a row, so there is a real wait here. Shaped like the table it replaces
 * so the page does not jump when it arrives.
 */
export default function LoadingImport() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 md:px-5" aria-busy="true">
      <div className="h-7 w-64 animate-pulse rounded-lg bg-muted/40" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted/30" />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-14 animate-pulse border-b border-border/60 bg-muted/10 last:border-0" />
        ))}
      </div>
      <span className="sr-only">Rebuilding candidates…</span>
    </main>
  );
}
