import { NextRequest, NextResponse } from 'next/server';
import { SendOtpSchema } from '@vent/validation';
import { authService } from '@/features/auth/auth-service';

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = SendOtpSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid phone number format. Must be Indian E.164 (+91...).', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const result = await authService.sendOtp(parsed.data.phone);
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to send OTP' },
      { status: 500 }
    );
  }
}
