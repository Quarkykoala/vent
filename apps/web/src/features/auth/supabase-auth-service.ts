import {
  UserRepository,
  ListenerRepository,
  generatePseudonym,
} from '@vent/db';
import { UserRole, type UserRoleType } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerClient } from '@/lib/supabase-server';
import type { AuthSession, IAuthService } from './types';

export class SupabaseAuthService implements IAuthService {
  /**
   * Dispatches an authentic SMS OTP via Supabase Auth.
   * STRICT INVARIANT: No deterministic fallback OTP (e.g. 123456) in production runtime code.
   */
  async sendOtp(phone: string): Promise<{ success: boolean; message: string }> {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: {
        channel: 'sms',
      },
    });

    if (error) {
      throw new Error(`Supabase Auth OTP dispatch failed: ${error.message}`);
    }

    return { success: true, message: `OTP sent successfully to ${phone}` };
  }

  /**
   * Verifies an OTP code via Supabase Auth and provisions or retrieves the corresponding public.users record.
   * Guarantees:
   * 1. 18+ age verification is validated and persisted.
   * 2. Empathetic pseudonymous handle generated and stored.
   * 3. Phone/email never stored in public.users or exposed to listeners.
   * 4. Staff roles cannot be client-selected.
   */
  async verifyOtp(params: {
    phone: string;
    code: string;
    ageConfirmed: boolean;
  }): Promise<{ session: AuthSession }> {
    const { phone, code, ageConfirmed } = params;

    if (!ageConfirmed) {
      throw new Error('Age confirmation required (18+ only).');
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: 'sms',
    });

    if (error || !data.user || !data.session) {
      throw new Error(error?.message || 'Invalid or expired OTP code.');
    }

    const adminClient = getSupabaseAdmin();
    const userRepo = new UserRepository(adminClient);

    // Find or create corresponding public.users record
    let userRecord = await userRepo.findByAuthUserId(data.user.id);
    if (!userRecord) {
      userRecord = await userRepo.createUser({
        authUserId: data.user.id,
        handle: generatePseudonym(),
        ageVerifiedAt: new Date().toISOString(),
      });
    }

    if (userRecord.status === 'suspended' || userRecord.status === 'deleted') {
      throw new Error('Account access restricted.');
    }

    // Role derivation: staff roles must be provisioned via app_metadata by admin, NEVER client-selectable
    let role: UserRoleType = (data.user.app_metadata?.role as UserRoleType) || UserRole.USER;

    // Check if user is an active listener in listener_profiles
    const listenerRepo = new ListenerRepository(adminClient);
    const listenerProfile = await listenerRepo.findByUserId(userRecord.id);
    if (listenerProfile && (listenerProfile.status === 'active' || listenerProfile.status === 'training')) {
      if (role === UserRole.USER) {
        role = UserRole.LISTENER;
      }
    }

    // MFA status: Authenticator Assurance Level 2 (AAL2) or verified factors
    const mfaVerified =
      (data.session as any).aal === 'aal2' ||
      Boolean(data.user.factors?.some((f: any) => f.status === 'verified')) ||
      false;

    const session: AuthSession = {
      userId: userRecord.id,
      authUserId: data.user.id,
      handle: userRecord.handle,
      role,
      token: data.session.access_token,
      mfaVerified,
    };

    return { session };
  }

  /**
   * Cryptographically validates a JWT with Supabase Auth and returns the authenticated user session.
   * No in-memory cache as source of truth.
   */
  async getUserFromToken(token: string): Promise<AuthSession | null> {
    if (!token || token.trim() === '') {
      return null;
    }

    const adminClient = getSupabaseAdmin();
    const { data, error } = await adminClient.auth.getUser(token);

    if (error || !data.user) {
      return null;
    }

    const userRepo = new UserRepository(adminClient);
    let userRecord = await userRepo.findByAuthUserId(data.user.id);

    if (!userRecord) {
      userRecord = await userRepo.createUser({
        authUserId: data.user.id,
        handle: generatePseudonym(),
        ageVerifiedAt: new Date().toISOString(),
      });
    }

    if (userRecord.status !== 'active') {
      return null;
    }

    let role: UserRoleType = (data.user.app_metadata?.role as UserRoleType) || UserRole.USER;
    const listenerRepo = new ListenerRepository(adminClient);
    const listenerProfile = await listenerRepo.findByUserId(userRecord.id);
    if (listenerProfile && (listenerProfile.status === 'active' || listenerProfile.status === 'training')) {
      if (role === UserRole.USER) {
        role = UserRole.LISTENER;
      }
    }

    const mfaVerified =
      Boolean(data.user.factors?.some((f: any) => f.status === 'verified')) ||
      false;

    return {
      userId: userRecord.id,
      authUserId: data.user.id,
      handle: userRecord.handle,
      role,
      token,
      mfaVerified,
    };
  }
}
