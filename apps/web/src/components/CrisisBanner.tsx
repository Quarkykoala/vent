import React from 'react';
import Link from 'next/link';

export function CrisisBanner() {
  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs md:text-sm text-amber-900 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-amber-800">In Crisis?</span>
        <span>
          If you are in immediate danger or having thoughts of self-harm, please reach out for emergency support:
        </span>
        <span className="font-medium">Tele-MANAS: <strong>14416</strong> | Emergency: <strong>112</strong></span>
      </div>
      <Link
        href="/crisis"
        className="underline font-semibold hover:text-amber-950 whitespace-nowrap ml-4"
      >
        Verified Crisis Resources →
      </Link>
    </div>
  );
}
