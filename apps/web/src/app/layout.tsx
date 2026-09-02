import './globals.css';
import type { Metadata } from 'next';
import { Navbar } from '@/components/Navbar';
import { CrisisBanner } from '@/components/CrisisBanner';
import { DisclaimerBanner } from '@/components/DisclaimerBanner';

export const metadata: Metadata = {
  title: 'Venterr — Talk to a Trained Human Listener',
  description:
    'Need to talk now? Connect anonymously to a vetted trained human listener over private audio in under 3 minutes.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        <CrisisBanner />
        <Navbar />
        <main className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-6">
          {children}
        </main>
        <DisclaimerBanner />
      </body>
    </html>
  );
}
