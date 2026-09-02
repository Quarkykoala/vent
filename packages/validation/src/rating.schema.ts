import { z } from 'zod';

export const SubmitRatingSchema = z.object({
  sessionId: z.string().uuid(),
  stars: z.number().int().min(1).max(5),
  reasonTags: z.array(
    z.enum([
      'great_listener',
      'felt_heard',
      'calm_environment',
      'technical_issues',
      'listener_inattentive',
      'felt_judged',
      'interrupted_frequently',
      'boundary_concern',
    ])
  ).default([]),
  blockListener: z.boolean().default(false),
}).refine(
  (data) => {
    // If rating <= 3, at least one structured reason tag should be provided for quality feedback
    if (data.stars <= 3) {
      return data.reasonTags.length > 0;
    }
    return true;
  },
  {
    message: 'Please select at least one reason tag when providing a rating of 3 stars or lower.',
    path: ['reasonTags'],
  }
);

export type SubmitRatingInput = z.infer<typeof SubmitRatingSchema>;
