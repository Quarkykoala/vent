import React from 'react';

export function DisclaimerBanner() {
  return (
    <div className="bg-slate-100 border-t border-slate-200 py-6 px-4 text-xs text-slate-500 text-center">
      <div className="max-w-3xl mx-auto space-y-2">
        <p className="font-semibold text-slate-700">
          Important Service Scope & Clinical Boundary
        </p>
        <p>
          This service provides compassionate active listening with vetted, trained human listeners.
          It is <strong>NOT</strong> therapy, psychiatric treatment, clinical diagnosis, or an emergency crisis hotline.
          Listeners do not provide prescriptions or medical advice.
        </p>
        <p>
          Restricted strictly to adults aged 18 and older in India. All calls are private browser-based audio; no call recordings or audio transcripts are created or stored.
        </p>
      </div>
    </div>
  );
}
