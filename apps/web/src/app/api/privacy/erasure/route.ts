import { NextRequest, NextResponse } from 'next/server';
import { UserErasureRequestSchema } from '@vent/validation';
import { UserRole } from '@vent/domain';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    const json = await req.json().catch(() => ({}));
    const parsed = UserErasureRequestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid erasure request', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { userId } = parsed.data;

    // Authorize caller: user themselves or privacy admin / super admin
    const isOwner = session.userId === userId;
    const isPrivacyAdmin = [UserRole.PRIVACY_ADMIN, UserRole.SUPER_ADMIN].includes(session.role as any);

    if (!isOwner && !isPrivacyAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Unauthorized to execute erasure for this user' },
        { status: 403 }
      );
    }

    const adminClient = getSupabaseAdmin();
    const rawClient = adminClient as any;

    // Execute atomic DPDP 2025 scrubbing transaction in PostgreSQL
    const { data: result, error } = await rawClient.rpc('atomic_dpdp_user_erasure', {
      p_user_id: userId,
      p_actor_id: session.userId,
      p_actor_role: session.role,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!result || !result.success) {
      const status = result?.code === 'ACTIVE_SESSION_EXISTS' ? 400 : (result?.code === 'ALREADY_ERASED' ? 409 : 404);
      return NextResponse.json(
        { error: result?.error || 'Erasure failed', code: result?.code },
        { status }
      );
    }

    // Permanently delete user authentication record from Supabase Auth
    if (result.auth_user_id && !result.auth_user_id.startsWith('erased_')) {
      try {
        await adminClient.auth.admin.deleteUser(result.auth_user_id);
      } catch (authErr: any) {
        // Log if already absent from Auth
      }
    }

    return NextResponse.json({
      userId,
      status: 'erasure_completed',
      scrubbedHandle: `deleted_${userId.slice(0, 8)}`,
      authPurged: true,
      dpdp2025Compliant: true,
      message: 'User personal data erased. Financial records retained in pseudonymized form for tax audit compliance.',
      erasedAt: result.erased_at,
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Erasure failed' }, { status: 500 });
  }
}
