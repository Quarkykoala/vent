import { NextRequest, NextResponse } from 'next/server';
import { calculateRefundProposal, createRefundJournal, assertLedgerBalanced, DEFAULT_PRICING } from '@vent/domain';

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { sessionId, paymentId, failureReason, durationSeconds = 0 } = json;

    if (!paymentId || !failureReason) {
      return NextResponse.json({ error: 'paymentId and failureReason required' }, { status: 400 });
    }

    const proposal = calculateRefundProposal({
      durationSeconds,
      failureReason,
      paymentAmountPaise: DEFAULT_PRICING.pricePaise,
    });

    // Create balanced compensating ledger journal
    const eventId = crypto.randomUUID();
    const journal = createRefundJournal({
      eventId,
      paymentId,
      refundPaise: proposal.eligibleRefundPaise,
    });

    assertLedgerBalanced(journal);

    return NextResponse.json({
      refundId: crypto.randomUUID(),
      sessionId,
      paymentId,
      refundPaise: Number(proposal.eligibleRefundPaise),
      refundPercentage: proposal.refundPercentage,
      rationale: proposal.rationale,
      journalEntriesCount: journal.length,
      status: 'refund_processed',
      createdAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Refund failed' }, { status: 500 });
  }
}
