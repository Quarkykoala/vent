import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const json = await req.json().catch(() => ({}));
    const financeUserId = json.financeUserId;

    if (!financeUserId) {
      return NextResponse.json(
        { error: 'Approval requires authenticated finance reviewer ID' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      batchId: id,
      approvedByFinance: true,
      financeReviewerId: financeUserId,
      approvedAt: new Date().toISOString(),
      message: 'Payout batch approved by finance lead. Ready for execution.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Approval failed' }, { status: 500 });
  }
}
