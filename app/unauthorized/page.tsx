import type { Metadata } from "next";

import { getDashboardSession } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "No access" };
export const dynamic = "force-dynamic";

export default async function UnauthorizedPage() {
  const session = await getDashboardSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6">
      <div className="rounded-2xl border border-border bg-card p-7 shadow-soft">
        <h1 className="text-lg font-semibold">This account has no access</h1>

        <p className="mt-2 text-sm text-muted-foreground">
          You are signed in{session.email ? " as " : ""}
          {session.email ? <span className="font-medium text-foreground">{session.email}</span> : null}, but
          that address is not on the dashboard allow-list.
        </p>

        <p className="mt-3 text-sm text-muted-foreground">
          An administrator needs to add it to{" "}
          <code className="rounded bg-muted px-1">WHITELIST_EMAILS</code> or its domain to{" "}
          <code className="rounded bg-muted px-1">WHITELIST_DOMAINS</code>, then redeploy.
        </p>

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
