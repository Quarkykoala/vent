import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Lists bookable counselling capacity from verified counsellor-tier
 * provider profiles in the database. Never fabricates professionals: when
 * no verified counsellor supply exists, the list is honestly empty.
 */
export async function GET(req: NextRequest) {
  try {
    await authenticateRequest(req);
    const admin = getSupabaseAdmin();

    const { data: counsellors, error } = await (admin as any)
      .from('listener_profiles')
      .select('id, display_name, languages, topics')
      .eq('tier', 'counsellor')
      .eq('status', 'active');

    if (error) {
      return NextResponse.json({ error: 'Could not load counselling availability' }, { status: 500 });
    }

    return NextResponse.json({ slots: counsellors ?? [] });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
