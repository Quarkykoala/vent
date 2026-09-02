import { NextResponse } from 'next/server';
import { generateReconciliationReport } from '@vent/domain';

export async function GET() {
  const report = generateReconciliationReport(
    [
      { providerPaymentId: 'pay_001', amountPaise: 19900n, status: 'captured' },
      { providerPaymentId: 'pay_002', amountPaise: 19900n, status: 'captured' },
    ],
    [
      { providerPaymentId: 'pay_001', amountPaise: 19900n, status: 'captured' },
      { providerPaymentId: 'pay_002', amountPaise: 19900n, status: 'captured' },
    ]
  );

  return NextResponse.json(report);
}
