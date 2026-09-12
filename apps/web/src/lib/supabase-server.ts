import {
  createSupabaseClient,
  createSupabaseAdminClient,
  type TypedSupabaseClient,
} from '@vent/db';

function requiredSecret(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
  }
  throw new Error(`Missing required server configuration: ${names.join(' or ')}`);
}

export function getSupabaseServerUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (configured?.trim()) return configured.trim();

  // The URL is not a credential. Keep the standard local Supabase address for
  // developer ergonomics, but privileged/anon keys below always come from env.
  if (process.env.NODE_ENV !== 'production') {
    return 'http://127.0.0.1:54321';
  }
  throw new Error('Missing required server configuration: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL');
}

export function getSupabaseAnonKey(): string {
  return requiredSecret(['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY']);
}

export function getSupabaseServiceRoleKey(): string {
  return requiredSecret(['SUPABASE_SERVICE_ROLE_KEY']);
}

/**
 * Creates an RLS-scoped Supabase client on the server.
 * If an authToken (JWT) is provided, all database operations evaluate under that user's RLS policies.
 */
export function getSupabaseServerClient(authToken?: string): TypedSupabaseClient {
  return createSupabaseClient({
    supabaseUrl: getSupabaseServerUrl(),
    supabaseAnonKey: getSupabaseAnonKey(),
    authToken,
  });
}

/**
 * Creates an administrative Supabase client using the service_role key.
 * Used strictly for server-side user provisioning, webhook journaling, and system functions.
 * NEVER exposed to client-side bundles.
 */
export function getSupabaseAdmin(): TypedSupabaseClient {
  return createSupabaseAdminClient({
    supabaseUrl: getSupabaseServerUrl(),
    supabaseServiceRoleKey: getSupabaseServiceRoleKey(),
  });
}
