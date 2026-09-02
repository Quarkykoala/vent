'use client';

import React, { useState } from 'react';
import { SUPPORTED_LANGUAGES, SUPPORTED_TOPICS, DEFAULT_PRICING } from '@vent/domain';

export default function HomePage() {
  const [selectedTopic, setSelectedTopic] = useState<string>(SUPPORTED_TOPICS[0]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(SUPPORTED_LANGUAGES[0]);
  const [ageConfirmed, setAgeConfirmed] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const priceRupees = Number(DEFAULT_PRICING.pricePaise / 100n);

  const handleStartSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ageConfirmed) {
      alert('You must be 18 or older to use this service.');
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('Initiating support request and checking available listeners...');

    try {
      const response = await fetch('/api/support-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: selectedTopic,
          language: selectedLanguage,
          ageConfirmed: true,
          idempotencyKey: crypto.randomUUID(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create request');
      }

      setStatusMessage(
        `Support request created! Request ID: ${data.requestId}. Proceeding to checkout (Order: ₹${priceRupees}).`
      );
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
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

          {/* Price & Duration Transparency */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 font-medium">Session Duration</p>
              <p className="text-base font-bold text-slate-900">
                {DEFAULT_PRICING.sessionDurationMinutes} Minutes
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500 font-medium">Fixed Price</p>
              <p className="text-base font-bold text-emerald-700">₹{priceRupees}</p>
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
            disabled={!ageConfirmed || isSubmitting}
            className={`w-full py-3 px-4 rounded-xl text-white font-medium text-sm transition-all shadow-sm ${
              !ageConfirmed || isSubmitting
                ? 'bg-slate-300 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99]'
            }`}
          >
            {isSubmitting ? 'Connecting...' : `Start Session (₹${priceRupees})`}
          </button>
        </form>

        {statusMessage && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
            {statusMessage}
          </div>
        )}
      </div>

      <div className="mt-8 text-center text-xs text-slate-500">
        <p>🔒 End-to-end pseudonymous. The listener never sees your phone number or email.</p>
      </div>
    </div>
  );
}
