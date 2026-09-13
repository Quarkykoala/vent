import React from 'react';
import Link from 'next/link';

export function DisclaimerBanner() {
  return (
    <footer className="bg-slate-100 border-t border-slate-200 py-8 px-4 text-xs text-slate-500">
      <div className="max-w-4xl mx-auto space-y-4 text-center">
        <div>
          <p className="font-semibold text-slate-700 text-sm">
            Important Service Scope & Clinical Boundaries
          </p>
          <p className="mt-1 leading-relaxed max-w-2xl mx-auto">
            Venterr provides compassionate, pseudonymous human active listening.
            It is <strong>NOT</strong> therapy, psychiatric medical treatment, clinical diagnosis, or an emergency crisis hotline.
            Listeners do not prescribe medication or provide clinical advice.
          </p>
        </div>

        <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 pt-2 border-t border-slate-200 text-slate-600 font-medium">
          <span>🔒 Strict Zero-Recording & Zero-Transcript Guarantee</span>
          <span>•</span>
          <span>🇮🇳 Regulated Under DPDP Act 2023 & India IT Act</span>
          <span>•</span>
          <span>🔞 18+ Adults Only</span>
          <span>•</span>
          <Link href="/crisis" className="text-amber-700 hover:underline">
            Helplines: Tele-MANAS (14416)
          </Link>
        </div>

        <div className="text-slate-400 text-[11px] pt-2">
          © {new Date().getFullYear()} Venterr India. All rights reserved. Transparent fixed pricing (₹199 / ₹399 / ₹599) with automated technical failure refund protection.
        </div>
      </div>
    </footer>
  );
}
