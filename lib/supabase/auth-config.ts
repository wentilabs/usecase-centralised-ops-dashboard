export type SupabaseAuthConfig = {
  url: string;
  publishableKey: string;
};

export function getSupabaseAuthConfig(): SupabaseAuthConfig | null {
  const url = process.env.NEXT_PUBLIC_AUTH_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_AUTH_SUPABASE_PUBLISHABLE_KEY;

  return url && publishableKey ? { url, publishableKey } : null;
}
