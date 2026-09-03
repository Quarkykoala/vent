import { SupabaseAuthService } from './supabase-auth-service';
import type { IAuthService } from './types';

export * from './types';
export * from './supabase-auth-service';
export * from './mock-auth-service';
export * from './auth-guard';

// Default runtime singleton is SupabaseAuthService — no in-memory runtime fallback
export const authService: IAuthService = new SupabaseAuthService();
