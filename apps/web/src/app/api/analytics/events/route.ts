import { NextRequest, NextResponse } from 'next/server';
import { TrackAnalyticsEventSchema } from '@vent/validation';
import { createSafeAnalyticsEvent } from '@vent/domain';

export async function POST(req: NextRequest) {
  try {
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

    return NextResponse.json({
      ingested: true,
      event: safeEvent.event,
      distinctId: safeEvent.distinctId,
      sanitizedPropertiesCount: Object.keys(safeEvent.properties).length,
      timestamp: safeEvent.timestampIso,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Analytics ingestion rejected' }, { status: 400 });
  }
}
