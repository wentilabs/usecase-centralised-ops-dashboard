"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { getSafeRedirect } from "@/lib/auth-policy";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Step = "email" | "code";

export function AuthForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = getSafeRedirect(params.get("redirect"));

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(() => {
    const reason = params.get("reason");
    if (reason === "session_expired") return { text: "Your session expired — sign in again.", tone: "error" };
    if (reason === "unauthorized") return { text: "That address is not approved for this dashboard.", tone: "error" };
    return null;
  });
  const [busy, setBusy] = useState(false);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      // shouldCreateUser: false — an unapproved address must not be able to
      // create an auth user just by submitting this form.
      const { error } = await getSupabaseBrowserClient().auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
      setStep("code");
      setMessage({ text: "If that address is approved, a code is on its way.", tone: "info" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Could not send the code.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const { error } = await getSupabaseBrowserClient().auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: "email",
      });
      if (error) throw error;
      router.replace(redirectTo);
      router.refresh();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "That code was not accepted.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-sm text-muted-foreground">
        Authentication is not configured. Set <code className="rounded bg-muted px-1">NEXT_PUBLIC_AUTH_SUPABASE_URL</code>{" "}
        and <code className="rounded bg-muted px-1">NEXT_PUBLIC_AUTH_SUPABASE_PUBLISHABLE_KEY</code>.
      </p>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";
  const buttonClass =
    "w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50";

  return (
    <div className="flex flex-col gap-4">
      {step === "email" ? (
        <form className="flex flex-col gap-3" onSubmit={sendCode}>
          <label className="text-xs text-muted-foreground" htmlFor="email">
            Work email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            className={inputClass}
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className={buttonClass} type="submit" disabled={busy}>
            {busy ? "Sending…" : "Email me a sign-in code"}
          </button>
        </form>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={verifyCode}>
          <label className="text-xs text-muted-foreground" htmlFor="code">
            6-digit code sent to {email}
          </label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            required
            className={inputClass}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className={buttonClass} type="submit" disabled={busy}>
            {busy ? "Verifying…" : "Sign in"}
          </button>
        </form>
      )}

      {message ? (
        <p className={message.tone === "error" ? "text-sm text-danger" : "text-sm text-muted-foreground"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
