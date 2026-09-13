import { NextRequest, NextResponse } from 'next/server';
import { CounsellingReferralOfferSchema } from '@vent/validation';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    const json = await req.json().catch(() => ({}));
    const parsed = CounsellingReferralOfferSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid referral input', details: parsed.error.format() }, { status: 400 });
    }

    const { sessionId, category } = parsed.data;
    const partnerId = json.partnerId;
    const adminClient = getSupabaseAdmin();

    // 1. Look up session
    const { data: sessionRow, error: sessErr } = await adminClient
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessErr || !sessionRow) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // 2. Authorize caller: user or assigned listener
    const isUser = (sessionRow as any).user_id === session.userId;
    let isListener = false;

    const { data: lp } = await adminClient
      .from('listener_profiles')
      .select('id, tier')
      .eq('user_id', session.userId)
      .maybeSingle();

    if (lp && (lp as any).id === (sessionRow as any).listener_id) {
      isListener = true;
    }

    if (!isUser && !isListener) {
      return NextResponse.json({ error: 'Forbidden: Caller is not a participant in this session' }, { status: 403 });
    }

    // 3. Listener tier verification: clinical categories require counsellor tier
    if (isListener && (category as string) === 'clinical_evaluation' && (lp as any).tier !== 'counsellor') {
      return NextResponse.json({
        error: 'Tier ineligibility: Clinical referrals require counsellor tier qualification.',
        code: 'COUNSELLOR_TIER_REQUIRED',
      }, { status: 403 });
    }

    // 4. Partner verification if provided
    let verifiedPartnerId: string | null = null;
    if (partnerId) {
      const { data: partner } = await adminClient
        .from('counselling_partners' as any)
        .select('id')
        .eq('id', partnerId)
        .eq('status', 'active')
        .maybeSingle();

      if (!partner) {
        return NextResponse.json({ error: 'Selected partner is not an active licensed partner' }, { status: 400 });
      }
      verifiedPartnerId = (partner as any).id;
    }

    // 5. Persist referral record in PostgreSQL
    const { data: referral, error: refErr } = await (adminClient.from('counselling_referrals' as any) as any)
      .insert({
        session_id: sessionId,
        user_id: (sessionRow as any).user_id,
        referred_by_listener_id: (sessionRow as any).listener_id,
        partner_id: verifiedPartnerId,
        category,
        state: 'offered',
        user_consented: false,
      })
      .select()
      .single();

    if (refErr || !referral) {
      return NextResponse.json({ error: refErr?.message || 'Failed to create referral' }, { status: 500 });
    }

    return NextResponse.json({
      referralId: (referral as any).id,
      sessionId,
      category,
      state: 'offered',
      isNonDiagnostic: true,
      offerMessage: 'A licensed professional therapist or counsellor can offer ongoing support for this concern.',
      createdAt: (referral as any).created_at,
    }, { status: 201 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Referral failed' }, { status: 500 });
  }
}
