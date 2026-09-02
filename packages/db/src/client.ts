import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export type TypedSupabaseClient = SupabaseClient<Database>;

export interface ClientOptions {
  supabaseUrl: string;
  supabaseAnonKey: string;
  authToken?: string;
}

/**
 * Creates a standard Supabase client using anon key.
 * Respects RLS for the authenticated context.
 */
export function createSupabaseClient(options: ClientOptions): TypedSupabaseClient {
  const { supabaseUrl, supabaseAnonKey, authToken } = options;

  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: typeof window !== 'undefined',
      autoRefreshToken: typeof window !== 'undefined',
    },
    global: {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    },
  });
}

export interface AdminClientOptions {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

/**
 * Creates a privileged Supabase Admin client with service_role key.
 * STRICT INVARIANT: Must NEVER run in a browser client environment.
 */
export function createSupabaseAdminClient(
  options: AdminClientOptions
): TypedSupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error(
      'Security Invariant Violation: Attempted to instantiate Supabase Admin client in a browser environment. Service role key must never be exposed client-side.'
    );
  }

  const { supabaseUrl, supabaseServiceRoleKey } = options;

  if (!supabaseServiceRoleKey || supabaseServiceRoleKey.trim().length === 0) {
    throw new Error('Supabase service role key is required for admin client.');
  }

  return createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
