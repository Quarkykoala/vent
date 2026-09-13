/**
 * Razorpay refund adapter.
 *
 * Reports exactly what the provider said — never a guess:
 *   settled            the provider accepted and processed the refund
 *   provider_accepted  the provider accepted it but it is not settled yet
 *   failed             the provider rejected it (no money moved)
 *   ambiguous          the request left this process without a usable answer
 *   not_configured     no credentials exist, so nothing was attempted
 */

export type ProviderRefundOutcome =
  | 'settled'
  | 'provider_accepted'
  | 'failed'
  | 'ambiguous'
  | 'not_configured';

export interface ProviderRefundResult {
  outcome: ProviderRefundOutcome;
  providerRefundId: string | null;
  detail: string;
}

const REFUND_TIMEOUT_MS = 10_000;

export function isRefundProviderConfigured(): boolean {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) return false;
  if (/placeholder/i.test(key) || /placeholder/i.test(secret)) return false;
  if (/^simulated/i.test(key)) return false;
  return true;
}

export async function createProviderRefund(params: {
  providerPaymentId: string;
  amountPaise: number;
  reason: string;
}): Promise<ProviderRefundResult> {
  if (!isRefundProviderConfigured()) {
    return {
      outcome: 'not_configured',
      providerRefundId: null,
      detail: 'Razorpay credentials are not configured; no provider refund was attempted.',
    };
  }

  const credentials = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFUND_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(params.providerPaymentId)}/refund`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        // `notes` carries only non-sensitive operational values.
        body: JSON.stringify({
          amount: params.amountPaise,
          speed: 'normal',
          notes: { reason: params.reason },
        }),
        signal: controller.signal,
      }
    );

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const description =
        body?.error?.description ?? body?.error?.reason ?? `provider rejected the refund (HTTP ${res.status})`;
      return { outcome: 'failed', providerRefundId: null, detail: String(description) };
    }

    const providerRefundId: string | null = body?.id ?? null;
    const status: string = body?.status ?? 'unknown';

    if (status === 'processed') {
      return { outcome: 'settled', providerRefundId, detail: `provider status: ${status}` };
    }
    if (status === 'pending') {
      return { outcome: 'provider_accepted', providerRefundId, detail: `provider status: ${status}` };
    }
    // Any other provider status is not proof of settlement.
    return {
      outcome: 'ambiguous',
      providerRefundId,
      detail: `unrecognised provider status: ${status}`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      outcome: 'ambiguous',
      providerRefundId: null,
      detail: `provider call did not complete: ${message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
