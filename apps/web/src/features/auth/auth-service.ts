import { generatePseudonym } from '@vent/db';
import { UserRole, type UserRoleType } from '@vent/domain';

export interface AuthSession {
  userId: string;
  authUserId: string;
  handle: string;
  role: UserRoleType;
  token: string;
  mfaVerified: boolean;
}

export interface IAuthService {
  sendOtp(phone: string): Promise<{ success: boolean; message: string }>;
  verifyOtp(params: {
    phone: string;
    code: string;
    ageConfirmed: boolean;
  }): Promise<{ session: AuthSession }>;
}

export class MockAuthService implements IAuthService {
  // Ephemeral test storage
  private sentCodes = new Map<string, string>();
  private sessions = new Map<string, AuthSession>();

  async sendOtp(phone: string): Promise<{ success: boolean; message: string }> {
    // In test/mock mode, code is always deterministic or 123456
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

    const authUserId = `auth_${phone.replace(/\D/g, '')}`;
    const userId = `usr_${phone.replace(/\D/g, '').slice(-6)}`;
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

  getSession(token: string): AuthSession | null {
    return this.sessions.get(token) ?? null;
  }
}

// Global default service instance
export const authService: IAuthService = new MockAuthService();
