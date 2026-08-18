import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseAuthConfig } from "./auth-config";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseBrowserClient() {
  const config = getSupabaseAuthConfig();
  if (!config) throw new Error("Supabase authentication is not configured.");

  browserClient ??= createBrowserClient(config.url, config.publishableKey);
  return browserClient;
}
