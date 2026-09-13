import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    const { id } = await params;
    const adminClient = getSupabaseAdmin();

    const { data: referral, error: refErr } = await adminClient
      .from('counselling_referrals' as any)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (refErr || !referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }

    // STRICT PRIVACY INVARIANT: Partner transfer requires explicit user consent!
    if (!(referral as any).user_consented || (referral as any).state !== 'accepted') {
      return NextResponse.json({
        error: 'Strict Privacy Invariant: User consent required before partner transfer.',
        code: 'USER_CONSENT_REQUIRED',
      }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Transition to transferred
    await (adminClient.from('counselling_referrals' as any) as any)
      .update({
        state: 'transferred',
        transferred_at: now,
        updated_at: now,
      })
      .eq('id', id);

    // Audit log
    await (adminClient.from('audit_events') as any).insert({
      actor_id: session.userId,
      actor_role: session.role,
      action: 'counselling_referral_transferred',
      entity_type: 'counselling_referral',
      entity_id: id,
      metadata: { partnerId: (referral as any).partner_id, category: (referral as any).category },
      created_at: now,
    });

    // MINIMAL NECESSARY PAYLOAD: No session notes, no transcripts, only consented contact and category
    return NextResponse.json({
      referralId: id,
      state: 'transferred',
      transferredAt: now,
      partnerPayload: {
        category: (referral as any).category,
        consentedContact: (referral as any).consented_contact,
        languagePreference: (referral as any).sessions?.language || 'English',
      },
      message: 'Referral transferred to partner with user consent.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Transfer failed' }, { status: 500 });
  }
}
