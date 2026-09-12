import { NextRequest, NextResponse } from 'next/server';
import { TrackAnalyticsEventSchema } from '@vent/validation';
import { createSafeAnalyticsEvent } from '@vent/domain';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';

/**
 * Analytics event intake.
 *
 * The payload is validated and minimized, but there is deliberately NO
 * persistence sink: adding an analytics store (or any new analytics property)
 * requires a privacy review, so this endpoint must not claim to have stored
 * anything. It reports exactly what happened.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    const json = await req.json();
    const parsed = TrackAnalyticsEventSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid event payload', details: parsed.error.format() }, { status: 400 });
    }

    const safeEvent = createSafeAnalyticsEvent({
      event: parsed.data.event,
      distinctId: parsed.data.distinctId,
      properties: parsed.data.properties,
    });

    return NextResponse.json(
      {
        accepted: true,
        persisted: false,
        sink: 'none',
        reason:
          'No analytics sink is configured. Events are validated and minimized only; enabling persistence requires privacy review.',
        event: safeEvent.event,
        distinctId: safeEvent.distinctId,
        sanitizedPropertiesCount: Object.keys(safeEvent.properties).length,
        timestamp: safeEvent.timestampIso,
        authenticatedAs: session.userId,
      },
      { status: 202 }
    );
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Analytics ingestion rejected' }, { status: 400 });
  }
}
