'use client';

import React, { useRef, useState } from 'react';
import { SUPPORTED_LANGUAGES, SUPPORTED_TOPICS } from '@vent/domain';
import PhoneSignIn from '@/features/auth/PhoneSignIn';
import { openRazorpayCheckout } from '@/features/payments/razorpay-checkout';

export default function HomePage() {
  const [selectedTopic, setSelectedTopic] = useState<string>(SUPPORTED_TOPICS[0]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(SUPPORTED_LANGUAGES[0]);
  const [ageConfirmed, setAgeConfirmed] = useState<boolean>(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState<boolean>(false);
  const [completedRequest, setCompletedRequest] = useState<null | {
    requestId: string;
    topic: string;
    language: string;
    state: string;
    createdAt: string;
  }>(null);
  const [checkoutState, setCheckoutState] = useState<
    'idle' | 'creating' | 'order_ready' | 'confirming' | 'paid' | 'failed'
  >('idle');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [orderInfo, setOrderInfo] = useState<null | {
    orderId: string;
    paymentId: string;
    amountPaise: number;
    currency: string;
  }>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const submittedSelectionRef = useRef<{ topic: string; language: string } | null>(null);

  function getIdempotencyKey(): string {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    return idempotencyKeyRef.current;
  }

  function startNewRequest(): void {
    setCompletedRequest(null);
    submittedSelectionRef.current = null;
    idempotencyKeyRef.current = null;
    setCheckoutState('idle');
    setCheckoutError(null);
    setOrderInfo(null);
    setIsError(false);
    setStatusMessage('Started a new request. Choose topic and language, then request a listener.');
  }

  async function handleCreateOrder(): Promise<void> {
    if (!sessionToken || !completedRequest || checkoutState === 'creating' || checkoutState === 'confirming') {
      return;
    }
    setCheckoutState('creating');
    setCheckoutError(null);
    try {
      const response = await fetch('/api/payments/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ requestId: completedRequest.requestId }),
      });
      let data: any = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok) {
        if (response.status === 401) {
          setSessionToken(null);
          throw new Error('Your sign-in has expired. Please verify your number again.');
        }
        if (response.status === 503) {
          throw new Error('Payments are not configured right now. Please try again later.');
        }
        throw new Error(data?.error || 'Could not create a payment order.');
      }
      setOrderInfo({
        orderId: data.orderId,
        paymentId: data.paymentId,
        amountPaise: data.amountPaise,
        currency: data.currency,
      });
      setCheckoutState('order_ready');

      // Real provider key → open the hosted checkout. The handler only tells us
      // the user authorised a payment; entitlement still comes from the server
      // reading the webhook-validated state.
      const opened = await openRazorpayCheckout({
        keyId: data.keyId,
        orderId: data.orderId,
        amountPaise: Number(data.amountPaise),
        currency: data.currency,
        description: 'Private audio session with a trained listener',
        onAuthorised: () => {
          setCheckoutError('Payment authorised. Confirming with the bank — checking status...');
          void handleConfirmPayment();
        },
        onDismissed: () => {
          setCheckoutState('order_ready');
          setCheckoutError(
            'Checkout closed before payment completed. Nothing was charged. You can open it again or check the status.'
          );
        },
        onFailed: (reason) => {
          setCheckoutState('failed');
          setCheckoutError(`Payment failed: ${reason} No money was captured. You can try again.`);
        },
      });

      if (!opened) {
        // No real provider key (simulator/local test mode) or the script could
        // not load: keep the explicit, non-claiming panel and its status check.
        setCheckoutError(
          'Provider checkout is unavailable in this environment. Use the status check after completing a test payment.'
        );
      }
    } catch (err: any) {
      setCheckoutState('failed');
      setCheckoutError(err.message || 'Could not create a payment order. Check your connection and try again.');
    }
  }

  async function handleConfirmPayment(): Promise<void> {
    if (!sessionToken || !completedRequest || !orderInfo) return;
    setCheckoutState('confirming');
    setCheckoutError(null);
    try {
      const response = await fetch(`/api/support-requests/${completedRequest.requestId}/payment-status`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      let data: any = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok) {
        if (response.status === 401) {
          setSessionToken(null);
          throw new Error('Your sign-in has expired. Please verify your number again.');
        }
        throw new Error(data?.error || 'Could not check payment status.');
      }
      if (data.paymentState === 'captured' && ['paid', 'queued'].includes(data.requestState)) {
        setCheckoutState('paid');
        setCheckoutError(null);
        setCompletedRequest((prev) =>
          prev ? { ...prev, state: data.requestState } : prev
        );
      } else if (data.paymentState === 'failed') {
        setCheckoutState('failed');
        setCheckoutError('The payment failed. No money was captured. You can try creating the order again.');
      } else {
        setCheckoutState('order_ready');
        setCheckoutError(
          'Payment not confirmed yet. Only a validated bank confirmation completes payment — finishing checkout in the browser alone does not pay. Please complete the payment and check again.'
        );
      }
    } catch (err: any) {
      setCheckoutState('order_ready');
      setCheckoutError(err.message || 'Could not check payment status. Please try again.');
    }
  }

  const handleStartSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ageConfirmed) {
      setIsError(true);
      setStatusMessage('You must be 18 or older to use this service.');
      return;
    }
    if (!sessionToken) {
      setIsError(true);
      setStatusMessage('Please sign in with your mobile number first.');
      return;
    }
    if (isSubmitting) return;
    if (completedRequest) {
      setIsError(true);
      setStatusMessage('This request is already saved. Start a new request to submit again.');
      return;
    }

    setIsSubmitting(true);
    setIsError(false);
    setStatusMessage('Creating your support request...');
    const submittedTopic = selectedTopic;
    const submittedLanguage = selectedLanguage;

    try {
      const response = await fetch('/api/support-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          topic: submittedTopic,
          language: submittedLanguage,
          ageConfirmed: true,
          idempotencyKey: getIdempotencyKey(),
        }),
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok) {
        if (response.status === 401) {
          setSessionToken(null);
          throw new Error('Your sign-in has expired. Please verify your number again.');
        }
        throw new Error(data?.error || 'Failed to create request');
      }

      // Keep the same idempotency key after success: the completed state blocks
      // resubmission in the UI, and any later retry (e.g. a lost response)
      // returns the same persisted row instead of creating a duplicate.
      submittedSelectionRef.current = { topic: submittedTopic, language: submittedLanguage };
      setCompletedRequest({
        requestId: data.requestId,
        topic: data.topic,
        language: data.language,
        state: data.state,
        createdAt: data.createdAt,
      });
      setIsError(false);
      setStatusMessage(
        `Request saved. Topic: ${data.topic}. Language: ${data.language}. State: ${data.state}. ` +
          `Your next step is payment: proceed to checkout to pay for this request.`
      );
    } catch (err: any) {
      setIsError(true);
      setStatusMessage(`Error: ${err.message || 'Could not create your request. Check your connection and try again.'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Talk to someone who listens.
        </h1>
        <p className="mt-3 text-base text-slate-600">
          Anonymous browser audio with a vetted, trained human listener. No judgment, no recordings, no prescriptions.
        </p>
      </div>

      <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200">
        <form onSubmit={handleStartSession} className="space-y-6">
          {/* Topic Selection */}
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-2">
              What is on your mind?
            </label>
            <select
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {SUPPORTED_TOPICS.map((topic) => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </select>
          </div>

          {/* Language Selection */}
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-2">
              Preferred Language
            </label>
            <div className="grid grid-cols-2 gap-3">
              {SUPPORTED_LANGUAGES.map((lang) => (
                <button
                  type="button"
                  key={lang}
                  onClick={() => setSelectedLanguage(lang)}
                  className={`py-2 px-4 rounded-lg text-sm font-medium border text-center transition-all ${
                    selectedLanguage === lang
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                      : 'border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>

          {/* 18+ Age Gate & Non-Clinical Consent */}
          <div className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ageConfirmed}
                onChange={(e) => setAgeConfirmed(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs text-slate-600 leading-relaxed">
                I confirm that I am <strong>18 years of age or older</strong>. I understand that this service provides compassionate human listening and is <strong>not therapy, medical advice, or crisis intervention</strong>.
              </span>
            </label>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!ageConfirmed || !sessionToken || isSubmitting || completedRequest !== null}
            className={`w-full py-3 px-4 rounded-xl text-white font-medium text-sm transition-all shadow-sm ${
              !ageConfirmed || !sessionToken || isSubmitting || completedRequest !== null
                ? 'bg-slate-300 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99]'
            }`}
          >
            {isSubmitting
              ? 'Creating your request...'
              : completedRequest !== null
                ? 'Request saved'
                : 'Request a listener'}
          </button>
        </form>

        {completedRequest !== null && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900">
            <p className="font-semibold">Saved request</p>
            <p className="mt-1">
              Topic: {completedRequest.topic}. Language: {completedRequest.language}. State:{' '}
              {completedRequest.state}.
            </p>
            <p className="mt-1 font-mono">Request ID: {completedRequest.requestId}</p>
            {checkoutState === 'idle' && (
              <button
                type="button"
                onClick={handleCreateOrder}
                className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Proceed to checkout
              </button>
            )}
            {checkoutState === 'creating' && (
              <p className="mt-3 text-sm">Creating your payment order...</p>
            )}
            {(checkoutState === 'order_ready' || checkoutState === 'confirming' || checkoutState === 'failed') &&
              orderInfo !== null && (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3">
                  <p className="font-semibold text-slate-800">Payment order</p>
                  <p className="mt-1 text-slate-700">
                    Amount: {orderInfo.currency} {(orderInfo.amountPaise / 100).toFixed(2)}. Order:{' '}
                    {orderInfo.orderId}.
                  </p>
                  <p className="mt-1 text-slate-600">
                    Complete the payment with your bank. This page never marks payment successful
                    by itself — only a validated bank confirmation counts.
                  </p>
                  <button
                    type="button"
                    onClick={handleConfirmPayment}
                    disabled={checkoutState === 'confirming'}
                    className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {checkoutState === 'confirming' ? 'Checking payment...' : 'I have paid — check status'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateOrder}
                    disabled={checkoutState === 'confirming'}
                    className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Retry order
                  </button>
                </div>
              )}
            {checkoutState === 'failed' && orderInfo === null && (
              <button
                type="button"
                onClick={handleCreateOrder}
                className="mt-3 w-full rounded-lg border border-emerald-600 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
              >
                Retry checkout
              </button>
            )}
            {checkoutError !== null && (
              <p role="alert" className="mt-2 text-red-700">
                {checkoutError}
              </p>
            )}
            {checkoutState === 'paid' && (
              <div className="mt-3">
                <p className="font-semibold">
                  Payment confirmed by the bank. Your request is now in the paid queue and a
                  trained listener can be matched.
                </p>
                <a
                  href={`/queue?requestId=${completedRequest.requestId}`}
                  className="mt-3 block w-full rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-emerald-700"
                >
                  Watch your queue
                </a>
              </div>
            )}
            <button
              type="button"
              onClick={startNewRequest}
              className="mt-3 w-full rounded-lg border border-emerald-600 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
            >
              Start a new request
            </button>
          </div>
        )}

        {/* Phone sign-in sits inside the card but outside the request form: nested forms are invalid HTML. */}
        <div className="mt-6">
          <p className="block text-sm font-semibold text-slate-800 mb-2">
            Sign in with your mobile number
          </p>
          {sessionToken ? (
            <p className="text-sm text-emerald-700">
              Signed in. Your number stays private and is never shown to listeners.
            </p>
          ) : (
            <PhoneSignIn
              ageConfirmed={ageConfirmed}
              onAuthenticated={(token) => {
                setSessionToken(token);
                setIsError(false);
                setStatusMessage('Signed in. You can now request a listener.');
              }}
            />
          )}
        </div>

        {statusMessage && (
          <div
            role={isError ? 'alert' : 'status'}
            className={`mt-4 p-3 rounded-lg text-xs border ${
              isError
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            {statusMessage}
          </div>
        )}
      </div>

      <div className="mt-8 text-center text-xs text-slate-500">
        <p>🔒 Pseudonymous to your listener. The listener never sees your phone number or email.</p>
      </div>
    </div>
  );
}
