export interface QuestionLimiter {
  tryConsume(actor: string, asOf: string): boolean;
  remaining(actor: string, asOf: string): number;
}

export const QUESTIONS_PER_DAY = 2;

export function createQuestionLimiter(): QuestionLimiter {
  const counts = new Map<string, { date: string; used: number }>();
  return {
    tryConsume(actor, asOf) {
      const entry = counts.get(actor);
      if (!entry || entry.date !== asOf) {
        counts.set(actor, { date: asOf, used: 1 });
        return true;
      }
      if (entry.used >= QUESTIONS_PER_DAY) return false;
      entry.used += 1;
      return true;
    },
    remaining(actor, asOf) {
      const entry = counts.get(actor);
      if (!entry || entry.date !== asOf) return QUESTIONS_PER_DAY;
      return Math.max(0, QUESTIONS_PER_DAY - entry.used);
    },
  };
}
