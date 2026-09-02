import { z } from 'zod';

export const CreatePaymentOrderSchema = z.object({
  requestId: z.string().uuid(),
});

export const RazorpayWebhookHeadersSchema = z.object({
  'x-razorpay-signature': z.string().min(10),
});

export const RazorpayWebhookPayloadSchema = z.object({
  entity: z.literal('event'),
  account_id: z.string(),
  event: z.string(),
  contains: z.array(z.string()),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: z.string(),
        order_id: z.string(),
        amount: z.number().int().positive(),
        currency: z.literal('INR'),
        status: z.enum(['created', 'authorized', 'captured', 'refunded', 'failed']),
      }),
    }),
  }),
  created_at: z.number(),
});
