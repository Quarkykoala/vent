import { NextRequest, NextResponse } from 'next/server';
import { SubmitRatingSchema } from '@vent/validation';
import { calculateBayesianRating } from '@vent/domain';
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
    const parsed = SubmitRatingSchema.safeParse({ ...json, sessionId: id });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid rating submission', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { stars, reasonTags, blockListener } = parsed.data;
    const adminClient = getSupabaseAdmin();

    // 1. Verify session exists
    const { data: sessionRow, error: sessionErr } = await adminClient
      .from('sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (sessionErr || !sessionRow) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // 2. Authorize: Only the session user can rate
    if ((sessionRow as any).user_id !== session.userId) {
      return NextResponse.json(
        { error: 'Forbidden: Only the user who participated in this session can submit a rating' },
        { status: 403 }
      );
    }

    // 3. Verify session state is ended
    if ((sessionRow as any).state !== 'ended') {
      return NextResponse.json(
        { error: `Cannot rate session in '${(sessionRow as any).state}' state. Session must be ended.` },
        { status: 400 }
      );
    }

    // 4. Check for duplicate rating (unique constraint on session_id)
    const { data: existingRating } = await adminClient
      .from('ratings')
      .select('id')
      .eq('session_id', id)
      .maybeSingle();

    if (existingRating) {
      return NextResponse.json(
        { error: 'Session has already been rated (duplicate ratings prohibited)' },
        { status: 409 }
      );
    }

    // 5. Insert rating record
    const { data: insertedRating, error: ratingErr } = await adminClient
      .from('ratings')
      .insert({
        session_id: id,
        user_id: session.userId,
        listener_id: (sessionRow as any).listener_id,
        stars,
        reason_tags: reasonTags || [],
      } as any)
      .select()
      .single();

    if (ratingErr || !insertedRating) {
      return NextResponse.json({ error: ratingErr?.message || 'Failed to insert rating' }, { status: 500 });
    }

    // 6. Recalculate listener quality score using Bayesian smoothing
    const listenerId = (sessionRow as any).listener_id;
    const { data: ratingsStats } = await adminClient
      .from('ratings')
      .select('stars')
      .eq('listener_id', listenerId);

    let updatedBayesianQuality = 4.5;
    if (ratingsStats && ratingsStats.length > 0) {
      const count = ratingsStats.length;
      const sum = ratingsStats.reduce((acc, r: any) => acc + Number(r.stars), 0);
      const avg = sum / count;

      updatedBayesianQuality = calculateBayesianRating({
        averageRating: avg,
        totalRatedSessions: count,
        priorMean: 4.5,
        priorWeight: 20,
      });

      // Round to 2 decimal places
      const rounded = Math.round(updatedBayesianQuality * 100) / 100;
      await (adminClient.from('listener_profiles') as any)
        .update({ quality_prior: rounded })
        .eq('id', listenerId);
    }

    // 7. If block requested, insert block record
    let listenerBlocked = false;
    if (blockListener) {
      const { data: lProfile } = await adminClient
        .from('listener_profiles')
        .select('user_id')
        .eq('id', listenerId)
        .single();

      if (lProfile) {
        await adminClient.from('blocks').insert({
          blocker_id: session.userId,
          blocked_id: (lProfile as any).user_id,
          reason_code: 'rating_block',
        } as any);
        listenerBlocked = true;
      }
    }

    return NextResponse.json({
      ratingId: (insertedRating as any).id,
      sessionId: id,
      stars,
      reasonTags,
      listenerBlocked,
      updatedBayesianQuality,
      message: 'Rating recorded. Quality smoothed via Bayesian prior.',
      createdAt: (insertedRating as any).created_at,
    }, { status: 201 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Failed to submit rating' }, { status: 500 });
  }
}
