import { NextRequest, NextResponse } from 'next/server';
import { generateReconciliationReport } from '@vent/domain';
import { authenticateRequest, requirePermission, handleAuthError } from '@/features/auth/auth-guard';
import { fetchProviderTransactions } from '@/features/payments/razorpay-reconciliation';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requirePermission(session, 'canApprovePayouts');

    const adminClient = getSupabaseAdmin();
    const { data: entries, error } = await adminClient
      .from('ledger_entries')
      .select('account_code, direction, amount_paise');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let totalDebits = 0n;
    let totalCredits = 0n;
    const accountBalances: Record<string, { debits: string; credits: string; net: string }> = {};

    for (const entry of (entries || []) as any[]) {
      const amount = BigInt(entry.amount_paise);
      const code = entry.account_code;

      if (!accountBalances[code]) {
        accountBalances[code] = { debits: '0', credits: '0', net: '0' };
      }

      if (entry.direction === 'debit') {
        totalDebits += amount;
        accountBalances[code].debits = (BigInt(accountBalances[code].debits) + amount).toString();
      } else if (entry.direction === 'credit') {
        totalCredits += amount;
        accountBalances[code].credits = (BigInt(accountBalances[code].credits) + amount).toString();
      }

      accountBalances[code].net = (
        BigInt(accountBalances[code].debits) - BigInt(accountBalances[code].credits)
      ).toString();
    }

    const isBalanced = totalDebits === totalCredits;
    const windowStartIso = new Date(Date.now() - 30 * 86400000).toISOString();
    const windowEndIso = new Date().toISOString();

    let providerSection: Record<string, unknown>;
    const feed = await fetchProviderTransactions({ windowStartIso, windowEndIso });
    if (!feed.available) {
      providerSection = { available: false, reason: feed.reason, windowStartIso, windowEndIso };
    } else {
      const { data: localPayments } = await adminClient
        .from('payments')
        .select('provider_payment_id, amount_paise, state')
        .not('provider_payment_id', 'is', null);

      const local = ((localPayments ?? []) as Array<{ provider_payment_id: string; amount_paise: number; state: string }>)
        .map((p) => ({
          providerPaymentId: p.provider_payment_id,
          amountPaise: BigInt(p.amount_paise),
          status: (p.state === 'refunded' || p.state === 'partially_refunded' ? 'refunded' : 'captured') as
            | 'captured'
            | 'refunded',
        }))
        .filter((p) => p.status === 'captured' || p.status === 'refunded');

      const report = generateReconciliationReport(feed.transactions, local);
      providerSection = {
        available: true,
        windowStartIso: feed.windowStartIso,
        windowEndIso: feed.windowEndIso,
        providerTransactions: feed.transactions.length,
        localTransactions: local.length,
        ...report,
      };
    }

    return NextResponse.json({
      isBalanced,
      totalDebitsPaise: totalDebits.toString(),
      totalCreditsPaise: totalCredits.toString(),
      entriesCount: entries?.length || 0,
      accountBalances,
      reconciliationStatus: isBalanced ? 'balanced' : 'unbalanced_discrepancy',
      providerReconciliation: providerSection,
      timestamp: new Date().toISOString(),
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Reconciliation failed' }, { status: 500 });
  }
}
