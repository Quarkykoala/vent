import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    market: 'India',
    platform: 'vent-marketplace',
    timestamp: new Date().toISOString(),
  });
}
