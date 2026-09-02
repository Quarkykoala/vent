import { NextRequest, NextResponse } from 'next/server';
import { CreateSupportRequestSchema } from '@vent/validation';
import { SupportRequestState } from '@vent/domain';

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = CreateSupportRequestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request input', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { topic, language, idempotencyKey } = parsed.data;

    // Support request creation with domain state
    const requestId = crypto.randomUUID();
    const responsePayload = {
      requestId,
      state: SupportRequestState.CREATED,
      topic,
      language,
      idempotencyKey,
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
