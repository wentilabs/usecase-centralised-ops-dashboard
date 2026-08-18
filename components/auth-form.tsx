"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { getSafeRedirect } from "@/lib/auth-policy";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Step = "email" | "code";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const subscribeToHydration = () => () => undefined;

export function AuthForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string>();
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The Turnstile widget can only render in the browser, and the auth project
  // exempts loopback origins from CAPTCHA — so decide after hydration.
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const isLoopback = isHydrated
    ? LOOPBACK_HOSTNAMES.has(window.location.hostname.toLowerCase())
    : null;

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const needsCaptcha = Boolean(siteKey) && isLoopback !== true;
  const captchaMisconfigured = isLoopback === false && !siteKey;

  const redirectTo = useMemo(() => getSafeRedirect(searchParams.get("redirect")), [searchParams]);

  const [notice, setNotice] = useState<string | null>(null);
  const reasonMessage =
    searchParams.get("reason") === "session_expired" ? "Your session expired — sign in again." : null;
  const message = notice ?? reasonMessage;
  const setMessage = setNotice;

  const resetCaptcha = () => {
    setCaptchaToken(undefined);
    setTurnstileKey((current) => current + 1);
  };

  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    if (captchaMisconfigured) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          // Self-service, as in the sibling portals: a first-time colleague can
          // request a code without being provisioned by hand. Creating an auth
          // user grants nothing on its own — the allow-list still decides who
          // reaches the dashboard, and every config change is audited.
          shouldCreateUser: true,
          ...(needsCaptcha && captchaToken ? { captchaToken } : {}),
        },
      });

      // Turnstile tokens are single-use; clear it whatever the outcome.
      resetCaptcha();
      if (sendError) throw sendError;

      setStep("code");
      setMessage("If that address is approved, a code is on its way.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send the code.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      // Mail clients love to add spaces, and people sometimes paste the whole
      // line from the email — keep only the digits.
      const token = otpCode.replace(/\D/g, "");
      if (token.length < 6) {
        throw new Error("Enter the 6-digit code from the email.");
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token,
        type: "email",
      });
      if (verifyError) throw verifyError;

      router.replace(redirectTo);
      router.refresh();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "That code was not accepted.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-sm text-muted-foreground">
        Authentication is not configured. Set{" "}
        <code className="rounded bg-muted px-1">NEXT_PUBLIC_AUTH_SUPABASE_URL</code> and{" "}
        <code className="rounded bg-muted px-1">NEXT_PUBLIC_AUTH_SUPABASE_PUBLISHABLE_KEY</code>.
      </p>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";
  const buttonClass =
    "w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50";

  return (
    <div className="flex flex-col gap-4">
      {captchaMisconfigured ? (
        <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          This auth project requires CAPTCHA, but{" "}
          <code className="rounded bg-muted px-1">NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> is not set —
          sign-in will be rejected until it is.
        </p>
      ) : null}

      {step === "email" ? (
        <form className="flex flex-col gap-3" onSubmit={sendOtp}>
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

          {siteKey && isLoopback === false ? (
            <Turnstile
              key={turnstileKey}
              id="sign-in-otp"
              siteKey={siteKey}
              onSuccess={setCaptchaToken}
              onExpire={() => setCaptchaToken(undefined)}
              onError={() => setCaptchaToken(undefined)}
              options={{ theme: "dark", size: "flexible" }}
            />
          ) : null}

          <button
            className={buttonClass}
            type="submit"
            disabled={isSubmitting || captchaMisconfigured || (needsCaptcha && !captchaToken)}
          >
            {isSubmitting ? "Sending…" : "Email me a sign-in code"}
          </button>
        </form>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={verifyOtp}>
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
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value)}
          />
          <button className={buttonClass} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Verifying…" : "Sign in"}
          </button>

          {error ? (
            <p className="text-[11px] text-muted-foreground">
              Codes are single-use and expire. If you opened the link in the email, that already
              consumed the code — request a fresh one.
            </p>
          ) : null}

          <div className="flex justify-between gap-3 text-xs">
            <button
              type="button"
              className="text-muted-foreground hover:text-primary"
              onClick={() => {
                setStep("email");
                setOtpCode("");
                setError(null);
                setMessage(null);
                resetCaptcha();
              }}
            >
              ← Use a different email
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-primary"
              onClick={() => {
                setStep("email");
                setOtpCode("");
                setError(null);
                setMessage("Request a new code below.");
                resetCaptcha();
              }}
            >
              Send a new code
            </button>
          </div>
        </form>
      )}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!error && message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
