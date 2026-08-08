import {
  createQuestionLimiter,
  type QuestionLimiter,
} from "@/domains/workplace/shared/limiter";

const globalForLimiter = globalThis as unknown as { __orgQuestionLimiter?: QuestionLimiter };

export function getQuestionLimiter(): QuestionLimiter {
  if (!globalForLimiter.__orgQuestionLimiter) {
    globalForLimiter.__orgQuestionLimiter = createQuestionLimiter();
  }
  return globalForLimiter.__orgQuestionLimiter;
}
