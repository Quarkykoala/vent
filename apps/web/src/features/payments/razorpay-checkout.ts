/**
 * Razorpay Checkout integration.
 *
 * The browser never decides that a payment succeeded: Checkout's `handler` only
 * tells us the modal closed after a successful authorisation, and we then read
 * the server's authoritative payment state (the webhook is what actually
 * entitles the request). Cancellation and failure are surfaced honestly.
 *
 * Fail-closed: if the provider script cannot be loaded, or the key is not a real
 * provider key, we do not pretend a checkout happened.
 */

export const RAZORPAY_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

/** Keys that are placeholders or test simulators rather than real provider keys. */
export function isRealCheckoutKey(keyId: string | null | undefined): boolean {
  if (!keyId) return false;
  const value = keyId.trim();
  if (value.length < 12) return false;
  if (/placeholder/i.test(value)) return false;
  if (/^simulated/i.test(value)) return false;
  return /^rzp_(test|live)_[A-Za-z0-9]+$/.test(value);
}

export interface RazorpayCheckoutOptions {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  description: string;
  onAuthorised: (providerPaymentId: string) => void;
  onDismissed: () => void;
  onFailed: (reason: string) => void;
}

interface RazorpayCheckoutInstance {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
}

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayCheckoutInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let scriptPromise: Promise<boolean> | null = null;

/** Injects the provider script once; resolves false when it cannot load. */
export function loadRazorpayCheckoutScript(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(window.Razorpay)));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/**
 * Opens the provider checkout for a server-created order. Returns false when
 * checkout could not be opened at all, so the caller can fall back explicitly
 * instead of leaving the user on a dead screen.
 */
export async function openRazorpayCheckout(options: RazorpayCheckoutOptions): Promise<boolean> {
  if (!isRealCheckoutKey(options.keyId)) return false;

  const loaded = await loadRazorpayCheckoutScript();
  if (!loaded || typeof window === 'undefined' || !window.Razorpay) return false;

  const instance = new window.Razorpay({
    key: options.keyId,
    order_id: options.orderId,
    amount: options.amountPaise,
    currency: options.currency,
    name: 'Venterr',
    description: options.description,
    // No prefill: the phone number is never handed to the payment page by us.
    theme: { color: '#059669' },
    handler: (response: { razorpay_payment_id?: string }) => {
      options.onAuthorised(response?.razorpay_payment_id ?? '');
    },
    modal: {
      ondismiss: () => options.onDismissed(),
    },
  });

  instance.on('payment.failed', (payload: unknown) => {
    const description =
      (payload as { error?: { description?: string } })?.error?.description ??
      'The payment could not be completed.';
    options.onFailed(description);
  });

  instance.open();
  return true;
}
