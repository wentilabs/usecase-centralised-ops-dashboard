/** The registry is one query, but the click should still land somewhere. */
export default function LoadingProjects() {
  return (
    <main className="flex w-full flex-col gap-4 px-3 py-4 md:px-5" aria-busy="true">
      <div className="h-7 w-56 animate-pulse rounded-lg bg-muted/40" />
      <div className="h-9 w-full max-w-md animate-pulse rounded-lg bg-muted/30" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="h-[158px] animate-pulse rounded-xl border border-border bg-card" />
        ))}
      </div>
      <span className="sr-only">Loading projects…</span>
    </main>
  );
}
