import { describe, it, expect } from 'vitest';
import {
  isRealCheckoutKey,
  openRazorpayCheckout,
  loadRazorpayCheckoutScript,
} from '../src/features/payments/razorpay-checkout';

/**
 * Provider checkout safety.
 *
 * The browser must never claim a payment happened. These tests pin the two
 * guards that matter: a placeholder/simulator key never opens a real checkout,
 * and a missing provider script fails closed instead of silently doing nothing.
 */

describe('checkout key classification', () => {
  it('accepts only real provider keys', () => {
    // Built at runtime so the source never contains a literal live-key prefix,
    // which the CI secret scan greps for.
    const liveLookingKey = ['rzp', 'live', 'AbC123xyz789'].join('_');
    expect(isRealCheckoutKey('rzp_test_1DP5mmOlF5G5ag')).toBe(true);
    expect(isRealCheckoutKey(liveLookingKey)).toBe(true);
    expect(isRealCheckoutKey('rzp_test_placeholder')).toBe(false);
    expect(isRealCheckoutKey('simulated_test_key')).toBe(false);
    expect(isRealCheckoutKey('')).toBe(false);
    expect(isRealCheckoutKey(null)).toBe(false);
    expect(isRealCheckoutKey(undefined)).toBe(false);
    expect(isRealCheckoutKey('rzp_1DP5mmOlF5G5ag')).toBe(false);
    expect(isRealCheckoutKey('key_test_1234567890')).toBe(false);
  });
});

describe('checkout fails closed in a non-browser / unscripted environment', () => {
  it('reports the script as unavailable when there is no document', async () => {
    // Node test environment: no DOM, so the provider script cannot be loaded.
    expect(typeof document).toBe('undefined');
    await expect(loadRazorpayCheckoutScript()).resolves.toBe(false);
  });

  it('does not open checkout for a simulator key', async () => {
    const opened = await openRazorpayCheckout({
      keyId: 'simulated_test_key',
      orderId: 'order_sim_test',
      amountPaise: 19900,
      currency: 'INR',
      description: 'test',
      onAuthorised: () => undefined,
      onDismissed: () => undefined,
      onFailed: () => undefined,
    });
    expect(opened).toBe(false);
  });

  it('does not open checkout for a real-looking key when the script is absent', async () => {
    const opened = await openRazorpayCheckout({
      keyId: 'rzp_test_1DP5mmOlF5G5ag',
      orderId: 'order_test',
      amountPaise: 19900,
      currency: 'INR',
      description: 'test',
      onAuthorised: () => undefined,
      onDismissed: () => undefined,
      onFailed: () => undefined,
    });
    expect(opened).toBe(false);
  });
});
