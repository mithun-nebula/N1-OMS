import type { Pool } from "pg";
import {
  createQuestionLimiter,
  type QuestionLimiter,
} from "@/domains/workplace/shared/limiter";
import { PostgresQuestionLimiterStore } from "./store-pg-limiter";

const globalForLimiter = globalThis as unknown as {
  __orgQuestionLimiter?: QuestionLimiter;
  __orgQuestionLimiterDurable?: boolean;
};

/**
 * The process-wide allowance.
 *
 * Built memory-only on first touch, because plenty of call sites reach for it
 * before the world (and therefore the pool) exists. `configureQuestionLimiter`
 * upgrades it in place once bootstrap has a pool — the limiter object stays
 * the same reference, so anything already holding it keeps working.
 */
export function getQuestionLimiter(): QuestionLimiter {
  if (!globalForLimiter.__orgQuestionLimiter) {
    globalForLimiter.__orgQuestionLimiter = createQuestionLimiter();
  }
  return globalForLimiter.__orgQuestionLimiter;
}

/**
 * Give the allowance durable backing and hydrate it, once.
 *
 * The hydration is deliberately *inside* this function rather than a `load()`
 * the caller must remember. It was a separate step to begin with, nothing in
 * `buildDemoWorld` called it, and the durable store sat there write-only —
 * every restart handed everyone a fresh two questions, which is precisely what
 * persisting it was meant to stop. A limiter that is durable but unhydrated is
 * now unrepresentable.
 */
export async function configureQuestionLimiter(
  pool: Pool | undefined,
  asOf: string,
): Promise<QuestionLimiter> {
  if (!pool || globalForLimiter.__orgQuestionLimiterDurable) {
    return getQuestionLimiter();
  }
  globalForLimiter.__orgQuestionLimiterDurable = true;
  const limiter = createQuestionLimiter(new PostgresQuestionLimiterStore(pool));
  globalForLimiter.__orgQuestionLimiter = limiter;
  await limiter.load(asOf);
  return limiter;
}
