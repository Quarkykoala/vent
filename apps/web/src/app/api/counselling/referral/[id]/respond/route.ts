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
    const json = await req.json().catch(() => ({}));
    const { response, consentedContact } = json;

    if (!['accepted', 'declined'].includes(response)) {
      return NextResponse.json({ error: "Response must be either 'accepted' or 'declined'" }, { status: 400 });
    }

    const adminClient = getSupabaseAdmin();

    // Look up referral
    const { data: referral, error: refErr } = await adminClient
      .from('counselling_referrals' as any)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (refErr || !referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }

    // Only the referred user can respond
    if ((referral as any).user_id !== session.userId) {
      return NextResponse.json({ error: 'Forbidden: Only the referred user can accept or decline' }, { status: 403 });
    }

    const isAccepted = response === 'accepted';
    const now = new Date().toISOString();

    const { data: updated, error: updErr } = await (adminClient.from('counselling_referrals' as any) as any)
      .update({
        state: isAccepted ? 'accepted' : 'declined',
        user_consented: isAccepted,
        consented_contact: isAccepted ? consentedContact || null : null,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single();

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({
      referralId: id,
      state: (updated as any).state,
      userConsented: (updated as any).user_consented,
      message: isAccepted ? 'Referral accepted with consent.' : 'Referral declined.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Response failed' }, { status: 500 });
  }
}
