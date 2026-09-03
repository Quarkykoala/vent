import {
  createSupabaseClient,
  createSupabaseAdminClient,
  type TypedSupabaseClient,
} from '@vent/db';

export function getSupabaseServerUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'http://127.0.0.1:54321'
  );
}

export function getSupabaseAnonKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
  );
}

export function getSupabaseServiceRoleKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
  );
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
