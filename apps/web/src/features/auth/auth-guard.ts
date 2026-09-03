import { NextRequest, NextResponse } from 'next/server';
import { assertRolePermission, type RolePermissions, type UserRoleType } from '@vent/domain';
import { authService } from './auth-service';
import type { AuthSession } from './types';

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Validates the Authorization header of an incoming NextRequest.
 * Derives the internal user identity from the cryptographically verified Supabase JWT.
 * Throws AuthError(401) on missing, invalid, or expired tokens.
 */
export async function authenticateRequest(req: NextRequest): Promise<AuthSession> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Authorization Bearer token required.', 401);
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    throw new AuthError('Empty bearer token provided.', 401);
  }

  const session = await authService.getUserFromToken(token);
  if (!session) {
    throw new AuthError('Invalid or expired authentication session.', 401);
  }

  return session;
}

/**
 * Enforces that the authenticated user possesses an allowed role.
 */
export function requireRole(session: AuthSession, allowedRoles: UserRoleType[]): void {
  if (!allowedRoles.includes(session.role)) {
    throw new AuthError(`Forbidden: Role '${session.role}' is not authorized.`, 403);
  }
}

/**
 * Enforces specific domain permissions and MFA requirements.
 */
export function requirePermission(
  session: AuthSession,
  permission: keyof RolePermissions
): void {
  try {
    assertRolePermission(session.role, permission, session.mfaVerified);
  } catch (err: any) {
    throw new AuthError(err.message || 'Forbidden: Insufficient privileges.', 403);
  }
}

/**
 * Helper to handle auth errors uniformly in Route Handlers.
 */
export function handleAuthError(err: any): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode });
  }
  return NextResponse.json(
    { error: err.message || 'Internal authentication error' },
    { status: 500 }
  );
}
