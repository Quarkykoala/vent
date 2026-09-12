import {
  UserRepository,
  ListenerRepository,
  generatePseudonym,
} from '@vent/db';
import { UserRole, type UserRoleType } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerClient } from '@/lib/supabase-server';
import type { AuthSession, IAuthService } from './types';

/**
 * Reads the authenticator assurance level from an access token that has already
 * been cryptographically validated by Supabase Auth. Factor enrollment is NOT
 * sufficient evidence that this particular session completed MFA.
 */
function hasCurrentAal2(token: string): boolean {
  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) return false;
    const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as {
      aal?: string;
    };
    return payload.aal === 'aal2';
  } catch {
    return false;
  }
}

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
      const message = (error?.message || '').toLowerCase();
      if (message.includes('expired')) {
        throw new Error('This code has expired. Please request a new one.');
      }
      throw new Error('Invalid code. Check the code and try again.');
    }

    const adminClient = getSupabaseAdmin();
    const userRepo = new UserRepository(adminClient);

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

    if (!userRecord.age_verified_at) {
      userRecord = await userRepo.recordAgeVerification(
        userRecord.id,
        new Date().toISOString()
      );
    }

    let role: UserRoleType = (data.user.app_metadata?.role as UserRoleType) || UserRole.USER;

    const listenerRepo = new ListenerRepository(adminClient);
    const listenerProfile = await listenerRepo.findByUserId(userRecord.id);
    if (listenerProfile && (listenerProfile.status === 'active' || listenerProfile.status === 'training')) {
      if (role === UserRole.USER) {
        role = UserRole.LISTENER;
      }
    }

    const mfaVerified = hasCurrentAal2(data.session.access_token);

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

    // `getUser(token)` above validated the token. We only trust the assurance
    // level carried by this current token; merely having a verified factor on
    // the account does not make an AAL1 session privileged.
    const mfaVerified = hasCurrentAal2(token);

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
