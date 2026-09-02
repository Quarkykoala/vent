import { NextResponse } from 'next/server';
import { generateWeeklyPayoutProposal } from '@vent/domain';

export async function GET() {
  const proposal = generateWeeklyPayoutProposal({
    sessions: [
      {
        sessionId: 'sess-p1',
        listenerId: 'list-101',
        earningsPaise: 10000n, // ₹100
        completedAtIso: new Date().toISOString(),
        isDisputed: false,
        hasSafetyIncident: false,
      },
      {
        sessionId: 'sess-p2-held',
        listenerId: 'list-102',
        earningsPaise: 10000n,
        completedAtIso: new Date().toISOString(),
        isDisputed: true, // HELD DISPUTE
        hasSafetyIncident: false,
      },
    ],
    periodStartIso: new Date(Date.now() - 7 * 86400000).toISOString(),
    periodEndIso: new Date().toISOString(),
  });

  return NextResponse.json({
    proposal: {
      ...proposal,
      totalBatchPaise: Number(proposal.totalBatchPaise),
      listeners: proposal.listeners.map((l) => ({
        ...l,
        totalPayoutPaise: Number(l.totalPayoutPaise),
      })),
    },
    message: 'Weekly payout batch generated. Pending human finance approval.',
  });
}
