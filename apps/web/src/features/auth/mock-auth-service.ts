import { generatePseudonym } from '@vent/db';
import { UserRole } from '@vent/domain';
import type { AuthSession, IAuthService } from './types';

/**
 * Isolated MockAuthService for standalone unit tests only.
 * STRICT REQUIREMENT: Never used as a production or runtime fallback.
 */
export class MockAuthService implements IAuthService {
  private sentCodes = new Map<string, string>();
  private sessions = new Map<string, AuthSession>();

  async sendOtp(phone: string): Promise<{ success: boolean; message: string }> {
    const code = '123456';
    this.sentCodes.set(phone, code);
    return { success: true, message: `OTP sent successfully to ${phone}` };
  }

  async verifyOtp(params: {
    phone: string;
    code: string;
    ageConfirmed: boolean;
  }): Promise<{ session: AuthSession }> {
    const { phone, code, ageConfirmed } = params;

    if (!ageConfirmed) {
      throw new Error('Age confirmation required (18+ only).');
    }

    const expected = this.sentCodes.get(phone) || '123456';
    if (code !== expected) {
      throw new Error('Invalid or expired OTP code.');
    }

    const authUserId = `00000000-0000-0000-0000-${phone.replace(/\D/g, '').slice(-12).padStart(12, '0')}`;
    const userId = `11111111-1111-1111-1111-${phone.replace(/\D/g, '').slice(-12).padStart(12, '0')}`;
    const handle = generatePseudonym();

    const session: AuthSession = {
      userId,
      authUserId,
      handle,
      role: UserRole.USER,
      token: `mock_jwt_${userId}`,
      mfaVerified: false,
    };

    this.sessions.set(session.token, session);
    return { session };
  }

  async getUserFromToken(token: string): Promise<AuthSession | null> {
    return this.sessions.get(token) ?? null;
  }

  // Test helper to seed sessions
  seedSession(session: AuthSession): void {
    this.sessions.set(session.token, session);
  }
}
