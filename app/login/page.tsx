import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth-form";
import { getSupabaseAuthConfig } from "@/lib/supabase/auth-config";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="rounded-2xl border border-border bg-card p-7 shadow-soft">
        <h1 className="text-lg font-semibold">🗂️ HALO Centralised Services</h1>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">
          Sign in with your work email to manage project configs.
        </p>
        <Suspense fallback={null}>
          <AuthForm configured={Boolean(getSupabaseAuthConfig())} />
        </Suspense>
      </div>
    </main>
  );
}
