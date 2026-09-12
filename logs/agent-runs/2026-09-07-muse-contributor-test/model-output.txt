"use client";

import { useState } from "react";
import type { FormEvent } from "react";

type PhoneSignInProps = {
  ageConfirmed: boolean;
  onAuthenticated: (token: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePhone(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s-]/g, "");
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }
  if (/^\+91[6-9]\d{9}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

function extractSessionToken(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const session = payload["session"];
  if (!isRecord(session)) return null;
  const token = session["token"];
  if (typeof token !== "string" || token.length === 0) return null;
  return token;
}

export default function PhoneSignIn({ ageConfirmed, onAuthenticated }: PhoneSignInProps) {
  const [phoneInput, setPhoneInput] = useState("");
  const [sentPhone, setSentPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const pending = sending || verifying;

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!ageConfirmed) return;

    const phone = normalizePhone(phoneInput);
    if (phone === null) {
      setError("Enter a valid 10-digit mobile number.");
      setStatus(null);
      return;
    }

    setSending(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      const ok =
        response.ok &&
        isRecord(payload) &&
        payload["success"] === true &&
        typeof payload["message"] === "string";
      if (!ok) {
        throw new Error("send-failed");
      }
      setSentPhone(phone);
      setCode("");
      setStatus("Code sent. Enter the 6-digit code.");
    } catch {
      setError("Could not send the code. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (sentPhone === null) return;
    if (!ageConfirmed) return;

    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError("Enter the 6-digit code.");
      setStatus(null);
      return;
    }

    setVerifying(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: sentPhone, code: trimmedCode, ageConfirmed: true }),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        throw new Error("verify-failed");
      }
      const token = extractSessionToken(payload);
      if (token === null) {
        throw new Error("verify-failed");
      }
      setPhoneInput("");
      setCode("");
      setSentPhone(null);
      setStatus(null);
      setError(null);
      onAuthenticated(token);
    } catch {
      setError("Verification failed. Check the code and try again.");
    } finally {
      setVerifying(false);
    }
  }

  function handleChangePhone() {
    if (pending) return;
    setSentPhone(null);
    setCode("");
    setError(null);
    setStatus(null);
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      {sentPhone === null ? (
        <form onSubmit={handleSend} noValidate>
          <label htmlFor="vent-phone" className="mb-1 block text-sm font-medium text-gray-900">
            Mobile number
          </label>
          <input
            id="vent-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            disabled={sending}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={sending || !ageConfirmed}
            className="mt-3 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} noValidate>
          <p className="text-sm text-gray-700">
            Code sent to <span className="font-medium text-gray-900">{sentPhone}</span>
          </p>
          <label htmlFor="vent-code" className="mb-1 mt-4 block text-sm font-medium text-gray-900">
            6-digit code
          </label>
          <input
            id="vent-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
            disabled={verifying}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm tracking-widest text-gray-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={verifying || !ageConfirmed}
            className="mt-3 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {verifying ? "Verifying…" : "Verify code"}
          </button>
          <button
            type="button"
            onClick={handleChangePhone}
            disabled={pending}
            className="mt-2 w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Change phone
          </button>
        </form>
      )}

      <div aria-live="polite" className="mt-3 min-h-5">
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : status ? (
          <p className="text-sm text-green-700">{status}</p>
        ) : null}
      </div>
    </div>
  );
}
