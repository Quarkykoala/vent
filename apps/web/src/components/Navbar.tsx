import React from 'react';
import Link from 'next/link';

export function Navbar() {
  return (
    <header className="border-b border-slate-200 bg-white sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight text-slate-900">
            Venterr<span className="text-emerald-600">.in</span>
          </span>
          <span className="text-xs bg-emerald-100 text-emerald-800 font-medium px-2 py-0.5 rounded-full">
            Trained Human Listeners
          </span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/crisis"
            className="text-red-700 hover:text-red-900 font-medium"
          >
            Emergency & Crisis Help
          </Link>
          <span className="text-slate-300">|</span>
          <span className="text-xs text-slate-500 font-medium">18+ Adults Only</span>
        </div>
      </div>
    </header>
  );
}
