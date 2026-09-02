import type { PricingConfig } from '../types';

export const DEFAULT_PRICING: PricingConfig = {
  sessionDurationMinutes: 20,
  pricePaise: 19900n, // ₹199.00
  currency: 'INR',
  listenerEarningsPaise: 10000n, // ₹100.00
};

export const SUPPORTED_LANGUAGES = ['English', 'Hindi'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const SUPPORTED_TOPICS = [
  'Relationship Conflict',
  'Breakup & Heartbreak',
  'Loneliness',
  'Work & Career Stress',
  'Family Issues',
  'Exam & Academic Pressure',
  'Grief & Loss',
  'Overthinking & Anxiety',
] as const;
export type SupportedTopic = (typeof SUPPORTED_TOPICS)[number];
