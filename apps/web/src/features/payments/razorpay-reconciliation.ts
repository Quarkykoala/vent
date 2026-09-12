import type { ProviderTransaction } from '@vent/domain';
import { isRefundProviderConfigured } from './razorpay-refunds';

/**
 * Provider-side transaction feed for reconciliation.
 *
 * Reconciling our ledger against the payment provider is only meaningful when a
 * provider is actually reachable. Without credentials this reports
 * `available: false` with the reason, so the reconciliation surface never
 * presents an invented "all clear".
 */

export type ProviderFeedResult =
  | { available: true; transactions: ProviderTransaction[]; windowStartIso: string; windowEndIso: string }
  | { available: false; reason: string };

const FEED_TIMEOUT_MS = 15_000;

function toProviderStatus(status: string | undefined): 'captured' | 'refunded' | null {
  if (status === 'captured') return 'captured';
  if (status === 'refunded') return 'refunded';
  return null;
}

export async function fetchProviderTransactions(params: {
  windowStartIso: string;
  windowEndIso: string;
}): Promise<ProviderFeedResult> {
  if (!isRefundProviderConfigured()) {
    return {
      available: false,
      reason:
        'Razorpay credentials are not configured, so no provider transactions can be fetched. Local ledger integrity is still verified.',
    };
  }

  const credentials = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);

  try {
    const from = Math.floor(new Date(params.windowStartIso).getTime() / 1000);
    const to = Math.floor(new Date(params.windowEndIso).getTime() / 1000);
    const res = await fetch(`https://api.razorpay.com/v1/payments?from=${from}&to=${to}&count=100`, {
      headers: { Authorization: `Basic ${credentials}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      return { available: false, reason: `Provider payment feed returned HTTP ${res.status}.` };
    }

    const body = await res.json().catch(() => null);
    const items: Array<Record<string, unknown>> = Array.isArray(body?.items) ? body.items : [];

    const transactions: ProviderTransaction[] = [];
    for (const item of items) {
      const id = typeof item.id === 'string' ? item.id : null;
      const amount = typeof item.amount === 'number' ? item.amount : null;
      const status = toProviderStatus(typeof item.status === 'string' ? item.status : undefined);
      if (!id || amount === null || !status) continue;
      transactions.push({ providerPaymentId: id, amountPaise: BigInt(amount), status });
    }

    return {
      available: true,
      transactions,
      windowStartIso: params.windowStartIso,
      windowEndIso: params.windowEndIso,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { available: false, reason: `Provider payment feed could not be reached: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}
