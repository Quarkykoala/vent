import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Crisis & Emergency Resources — Venterr',
  description: 'Verified 24/7 mental health emergency helplines in India.',
};

export default function CrisisPage() {
  const crisisResources = [
    {
      name: 'Tele-MANAS (Govt. of India)',
      number: '14416 / 1800 891 4416',
      availability: '24 Hours, 7 Days a week',
      languages: '20+ Indian Languages',
      description: 'National Tele Mental Health Programme providing immediate mental health counselling.',
    },
    {
      name: 'National Emergency Response (ERSS)',
      number: '112',
      availability: '24 Hours, 7 Days a week',
      languages: 'Pan-India Emergency',
      description: 'All-in-one emergency service for police, medical, and immediate life-safety emergencies.',
    },
    {
      name: 'KIRAN Mental Health Helpline',
      number: '1800-599-0019',
      availability: '24 Hours, 7 Days a week',
      languages: '13 Languages',
      description: 'Ministry of Social Justice and Empowerment helpline for psychological support and crisis management.',
    },
    {
      name: 'Vandrevala Foundation',
      number: '+91 9999 666 555',
      availability: '24 Hours, 7 Days a week',
      languages: 'English, Hindi, and Regional Languages',
      description: 'Free, confidential psychological support and crisis intervention.',
    },
  ];

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="mb-6">
        <Link href="/" className="text-sm font-medium text-emerald-700 hover:underline">
          ← Back to Venterr
        </Link>
      </div>

      <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 mb-8 text-red-950">
        <h1 className="text-2xl font-bold tracking-tight mb-2 text-red-900">
          Emergency & Crisis Resources (India)
        </h1>
        <p className="text-sm text-red-800 leading-relaxed">
          If you or someone you know is in immediate danger, having thoughts of self-harm, or experiencing a life-threatening crisis, please do not use this app. Reach out to verified professional emergency services immediately.
        </p>
      </div>

      <div className="space-y-4">
        {crisisResources.map((res) => (
          <div
            key={res.name}
            className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:border-slate-300 transition-all"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">{res.name}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{res.description}</p>
              </div>
              <span className="text-xs font-semibold bg-emerald-50 text-emerald-800 px-2.5 py-1 rounded-full whitespace-nowrap">
                {res.availability}
              </span>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-600">Languages: {res.languages}</span>
              <a
                href={`tel:${res.number.split('/')[0]?.replace(/[^0-9+]/g, '')}`}
                className="text-base font-extrabold text-emerald-700 hover:text-emerald-800"
              >
                📞 {res.number}
              </a>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 p-4 bg-slate-100 rounded-xl text-center text-xs text-slate-500">
        <p>Verified according to SOP Section C2. Last verified: 2026-09-01 by Clinical Operations.</p>
      </div>
    </div>
  );
}
