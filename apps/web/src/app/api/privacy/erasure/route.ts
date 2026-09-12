import { NextRequest, NextResponse } from 'next/server';
import { UserErasureRequestSchema } from '@vent/validation';
import { authenticateRequest, requirePermission, handleAuthError } from '@/features/auth/auth-guard';
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
    const isOwner = session.userId === userId;
    if (!isOwner) {
      requirePermission(session, 'canManagePrivacyRequests');
    }

    const adminClient = getSupabaseAdmin();
    const rawClient = adminClient as any;

    // Cross-system deletion cannot be one ACID transaction. Persist the Auth ID
    // before PostgreSQL pseudonymisation removes it so a failed Auth purge can
    // be retried safely and truthfully.
    const { data: existingJob, error: jobReadErr } = await rawClient
      .from('privacy_erasure_jobs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (jobReadErr) {
      return NextResponse.json({ error: jobReadErr.message }, { status: 500 });
    }

    let job = existingJob as any;
    if (!job) {
      const { data: userRow, error: userErr } = await adminClient
        .from('users')
        .select('id, auth_user_id, status')
        .eq('id', userId)
        .maybeSingle();
      if (userErr || !userRow) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const { data: createdJob, error: createErr } = await rawClient
        .from('privacy_erasure_jobs')
        .insert({
          user_id: userId,
          original_auth_user_id: (userRow as any).auth_user_id,
          requested_by: session.userId,
          status: 'requested',
        })
        .select()
        .single();
      if (createErr || !createdJob) {
        return NextResponse.json({ error: createErr?.message || 'Failed to create erasure job' }, { status: 500 });
      }
      job = createdJob;
    }

    if (job.status === 'completed') {
      return NextResponse.json({
        userId,
        status: 'erasure_completed',
        dbScrubbed: true,
        authPurged: true,
        idempotentReplay: true,
        erasedAt: job.completed_at,
      }, { status: 200 });
    }

    if (job.status === 'legal_hold') {
      return NextResponse.json(
        { error: 'Erasure is paused by a documented retention hold.', code: 'LEGAL_HOLD' },
        { status: 409 }
      );
    }

    if (job.status === 'requested') {
      const { data: result, error } = await rawClient.rpc('atomic_dpdp_user_erasure', {
        p_user_id: userId,
        p_actor_id: session.userId,
        p_actor_role: session.role,
      });

      if (error) {
        await rawClient.from('privacy_erasure_jobs').update({
          status: 'partial_failure',
          last_error: error.message,
          updated_at: new Date().toISOString(),
        }).eq('user_id', userId);
        return NextResponse.json({ error: error.message, status: 'erasure_partial_failure', authPurged: false }, { status: 500 });
      }

      if (!result?.success && result?.code !== 'ALREADY_ERASED') {
        const status = result?.code === 'ACTIVE_SESSION_EXISTS' ? 409 : result?.code === 'USER_NOT_FOUND' ? 404 : 400;
        return NextResponse.json({ error: result?.error || 'Erasure failed', code: result?.code }, { status });
      }

      await rawClient.from('privacy_erasure_jobs').update({
        status: 'auth_purge_pending',
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId);
      job.status = 'auth_purge_pending';
    }

    const authUserId = job.original_auth_user_id as string;
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(authUserId);
    const authAlreadyAbsent = Boolean(authDeleteError?.message && /not found|does not exist/i.test(authDeleteError.message));

    if (authDeleteError && !authAlreadyAbsent) {
      await rawClient.from('privacy_erasure_jobs').update({
        status: 'partial_failure',
        last_error: authDeleteError.message,
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId);

      return NextResponse.json({
        userId,
        status: 'erasure_partial_failure',
        dbScrubbed: true,
        authPurged: false,
        retryable: true,
        error: 'Application data was scrubbed, but the authentication identity could not yet be purged.',
      }, { status: 502 });
    }

    const completedAt = new Date().toISOString();
    const { error: completeErr } = await rawClient.from('privacy_erasure_jobs').update({
      status: 'completed',
      last_error: null,
      completed_at: completedAt,
      updated_at: completedAt,
    }).eq('user_id', userId);
    if (completeErr) {
      return NextResponse.json({
        userId,
        status: 'erasure_partial_failure',
        dbScrubbed: true,
        authPurged: true,
        retryable: true,
        error: 'Authentication identity was purged, but completion evidence could not be persisted.',
      }, { status: 500 });
    }

    return NextResponse.json({
      userId,
      status: 'erasure_completed',
      dbScrubbed: true,
      authPurged: true,
      retainedCategories: ['pseudonymized_financial_and_audit_records_required_for_legal_or_financial_obligations'],
      message: 'Erasure completed. Authentication identity was purged and the application record was pseudonymized; required financial/audit records remain non-identifying.',
      erasedAt: completedAt,
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Erasure failed' }, { status: 500 });
  }
}
