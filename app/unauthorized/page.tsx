import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDashboardSession } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "No access" };
export const dynamic = "force-dynamic";

export default async function UnauthorizedPage() {
  const session = await getDashboardSession();

  // Don't strand someone who actually has access (e.g. they arrived here from
  // a stale redirect after the config was fixed).
  if (session.allowed) redirect("/");

  const allowlistConfigured = Boolean(process.env.WHITELIST_EMAILS || process.env.WHITELIST_DOMAINS);

  // Say what actually failed, rather than always blaming the allow-list.
  const diagnosis = !session.configured
    ? {
        headline: "Authentication is not configured",
        detail:
          "The server has no auth project configured, so no one can be admitted. Set NEXT_PUBLIC_AUTH_SUPABASE_URL and NEXT_PUBLIC_AUTH_SUPABASE_PUBLISHABLE_KEY, then rebuild.",
      }
    : !session.email
      ? {
          headline: "Your session could not be verified",
          detail:
            "You reached this page without a readable session — it may have expired, or the server could not reach the auth project. Sign in again.",
        }
      : !allowlistConfigured
        ? {
            headline: "The allow-list is not reaching the server",
            detail:
              "You signed in fine, but this server sees no WHITELIST_EMAILS or WHITELIST_DOMAINS at all — so it admits nobody. The variables exist in the host's settings but are not being passed to the running app; they must be present at build time too.",
          }
        : {
            headline: "This account is not on the allow-list",
            detail:
              "The server can read the allow-list, and this address is not on it. Add the address to WHITELIST_EMAILS, or its domain to WHITELIST_DOMAINS.",
          };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <div className="rounded-2xl border border-border bg-card p-7 shadow-soft">
        <h1 className="text-lg font-semibold">{diagnosis.headline}</h1>

        {session.email ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{session.email}</span>
          </p>
        ) : null}

        <p className="mt-3 text-sm text-muted-foreground">{diagnosis.detail}</p>

        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-border bg-background p-3 font-mono text-[11px]">
          <dt className="text-muted-foreground">auth configured</dt>
          <dd>{String(session.configured)}</dd>
          <dt className="text-muted-foreground">session email</dt>
          <dd>{session.email ?? "none"}</dd>
          <dt className="text-muted-foreground">allow-list visible to server</dt>
          <dd>{String(allowlistConfigured)}</dd>
        </dl>

        <form action="/auth/sign-out" method="post" className="mt-5">
          <button
            type="submit"
            className="rounded-lg border border-border px-4 py-2 text-sm hover:border-primary hover:text-primary"
          >
            Sign out and try another address
          </button>
        </form>
      </div>
    </main>
  );
}
