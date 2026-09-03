import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';

export async function GET(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);

    // PRIVACY INVARIANT: Return pseudonymous handle, never phone or email!
    return NextResponse.json({
      userId: session.userId,
      handle: session.handle,
      role: session.role,
      mfaVerified: session.mfaVerified,
    });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
