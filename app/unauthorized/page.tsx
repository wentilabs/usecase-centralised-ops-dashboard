import type { Metadata } from "next";

export const metadata: Metadata = { title: "No access" };

export default function UnauthorizedPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-3 px-6">
      <h1 className="text-xl font-semibold">This account has no access</h1>
      <p className="text-sm text-muted-foreground">
        Your address is signed in but is not on the dashboard allow-list. Ask an administrator to add
        it to <code className="rounded bg-muted px-1">WHITELIST_EMAILS</code> or{" "}
        <code className="rounded bg-muted px-1">WHITELIST_DOMAINS</code>.
      </p>
      <a className="text-sm font-medium text-primary hover:underline" href="/login">
        Sign in with a different address
      </a>
    </main>
  );
}
