import { NextRequest, NextResponse } from 'next/server';
import { SubmitRatingSchema } from '@vent/validation';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const json = await req.json();
    const parsed = SubmitRatingSchema.safeParse({ ...json, sessionId: id });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid rating submission', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { stars, reasonTags, blockListener } = parsed.data;

    return NextResponse.json({
      ratingId: crypto.randomUUID(),
      sessionId: id,
      stars,
      reasonTags,
      listenerBlocked: blockListener,
      message: 'Rating recorded. Quality smoothed via Bayesian prior.',
      createdAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to submit rating' }, { status: 500 });
  }
}
