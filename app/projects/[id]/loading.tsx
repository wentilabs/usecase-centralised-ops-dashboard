/**
 * Shown the instant a project card is clicked.
 *
 * The page itself cannot be much faster: one Supabase round trip is about
 * 100ms and this needs the project and the service rows, so ~175ms is the
 * floor. What was missing was any acknowledgement that the click landed —
 * until the server replied, the registry just sat there and the click felt
 * dropped rather than slow.
 *
 * Shaped like the page it replaces, so the layout does not jump when the real
 * content arrives: the same heading block, then a grid of seven role cards.
 */
export default function LoadingCanonicalProject() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 md:px-5" aria-busy="true">
      <div className="h-7 w-48 animate-pulse rounded-lg bg-muted/40" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted/30" />
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
      <span className="sr-only">Loading project…</span>
    </main>
  );
}
