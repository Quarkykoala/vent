import { NextRequest, NextResponse } from 'next/server';
import { VerifyOtpSchema } from '@vent/validation';
import { authService } from '@/features/auth/auth-service';

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = VerifyOtpSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid verification payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const ageConfirmed = json.ageConfirmed === true;
    if (!ageConfirmed) {
      return NextResponse.json(
        { error: '18+ age verification required' },
        { status: 400 }
      );
    }

    const result = await authService.verifyOtp({
      phone: parsed.data.phone,
      code: parsed.data.code,
      ageConfirmed: true,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'OTP verification failed' },
      { status: 401 }
    );
  }
}
