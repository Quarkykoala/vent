import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_URL: z.string().min(1),
  NEXT_PUBLIC_RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
  TRIGGER_SECRET_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function validateEnv(env: Record<string, string | undefined>): EnvConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(`Invalid environment variables configuration: ${JSON.stringify(formatted, null, 2)}`);
  }
  return result.data;
}
