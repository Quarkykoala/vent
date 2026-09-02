import { NextRequest, NextResponse } from 'next/server';
import { authService, MockAuthService } from '@/features/auth/auth-service';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (authService instanceof MockAuthService) {
    const session = authService.getSession(token);
    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    // PRIVACY INVARIANT: Return pseudonymous handle, never phone or email!
    return NextResponse.json({
      userId: session.userId,
      handle: session.handle,
      role: session.role,
      mfaVerified: session.mfaVerified,
    });
  }

  return NextResponse.json({ error: 'Session lookup not implemented' }, { status: 501 });
}
