export interface ProviderTransaction {
  providerPaymentId: string;
  amountPaise: bigint;
  status: 'captured' | 'refunded';
}

export interface LocalLedgerSummary {
  providerPaymentId: string;
  amountPaise: bigint;
  status: 'captured' | 'refunded';
}

export interface ReconciliationDiscrepancy {
  providerPaymentId: string;
  type: 'missing_in_local' | 'missing_in_provider' | 'amount_mismatch' | 'status_mismatch';
  details: string;
}

export interface ReconciliationReport {
  reconciledAtIso: string;
  matchedCount: number;
  discrepanciesCount: number;
  discrepancies: ReconciliationDiscrepancy[];
}

/**
 * Reconciles provider transactions against local immutable ledger.
 * Non-destructive audit tool per SOP Part E/F.
 */
export function generateReconciliationReport(
  providerTxns: ProviderTransaction[],
  localTxns: LocalLedgerSummary[]
): ReconciliationReport {
  const localMap = new Map<string, LocalLedgerSummary>();
  for (const l of localTxns) {
    localMap.set(l.providerPaymentId, l);
  }

  const discrepancies: ReconciliationDiscrepancy[] = [];
  let matched = 0;

  for (const p of providerTxns) {
    const local = localMap.get(p.providerPaymentId);
    if (!local) {
      discrepancies.push({
        providerPaymentId: p.providerPaymentId,
        type: 'missing_in_local',
        details: `Transaction ${p.providerPaymentId} exists at payment gateway but missing in local ledger.`,
      });
      continue;
    }

    if (local.amountPaise !== p.amountPaise) {
      discrepancies.push({
        providerPaymentId: p.providerPaymentId,
        type: 'amount_mismatch',
        details: `Amount mismatch for ${p.providerPaymentId}: Provider=${p.amountPaise}, Local=${local.amountPaise}`,
      });
      continue;
    }

    if (local.status !== p.status) {
      discrepancies.push({
        providerPaymentId: p.providerPaymentId,
        type: 'status_mismatch',
        details: `Status mismatch for ${p.providerPaymentId}: Provider=${p.status}, Local=${local.status}`,
      });
      continue;
    }

    matched++;
  }

  return {
    reconciledAtIso: new Date().toISOString(),
    matchedCount: matched,
    discrepanciesCount: discrepancies.length,
    discrepancies,
  };
}
