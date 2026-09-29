export const FEEDBACK_RATINGS = ['helpful', 'partial', 'not_helpful'] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export const FEEDBACK_REASONS = [
  'Wrong or outdated info',
  "Didn't answer my question",
  'Missing steps or details',
  'Should have escalated / not in KB',
  'Other',
] as const;

export const MAX_FEEDBACK_COMMENT_LENGTH = 1000;
