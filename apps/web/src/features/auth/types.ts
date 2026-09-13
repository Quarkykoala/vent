import { type UserRoleType } from '@vent/domain';

export interface AuthSession {
  userId: string;       // internal public.users.id (UUID)
  authUserId: string;   // Supabase auth.users.id (UUID)
  handle: string;       // empathetic pseudonymous handle
  role: UserRoleType;   // server-authoritative role
  token: string;        // Supabase JWT access token
  mfaVerified: boolean; // whether MFA (aal2) is satisfied
}

export interface IAuthService {
  sendOtp(phone: string): Promise<{ success: boolean; message: string }>;
  verifyOtp(params: {
    phone: string;
    code: string;
    ageConfirmed: boolean;
  }): Promise<{ session: AuthSession }>;
  getUserFromToken(token: string): Promise<AuthSession | null>;
}
