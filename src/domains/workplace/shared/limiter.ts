export interface QuestionLimiter {
  tryConsume(actor: string, asOf: string): boolean;
  remaining(actor: string, asOf: string): number;
  /**
   * Pull today's counts back from durable storage. Awaited once at boot; a
   * no-op when the limiter is memory-only, as it is in every test.
   */
  load(asOf: string): Promise<void>;
}

/**
 * Durable backing for the allowance.
 *
 * Writes are fire-and-forget so `tryConsume` can stay synchronous — it is
 * called from inside `utility.capture`'s execute and from `recordMissReason`,
 * neither of which can await here without turning the whole call chain async.
 */
export interface QuestionLimiterPersistence {
  save(actor: string, date: string, used: number): Promise<void>;
  loadFor(date: string): Promise<Array<{ actor: string; used: number }>>;
}

export const QUESTIONS_PER_DAY = 2;

/**
 * At most two questions per person per day — the limit that "applies
 * everywhere in the application" (appendix A4), shared deliberately between
 * the day-plan's overrun question and `utility.capture`. One budget is the
 * spec: the point is that nobody is over-questioned in total, not that each
 * feature gets its own ration.
 *
 * Without persistence the counts lived in a `Map` pinned to `globalThis`, so
 * every restart or redeploy handed everyone a fresh allowance and the promise
 * was quietly broken.
 */
export function createQuestionLimiter(
  persistence?: QuestionLimiterPersistence,
): QuestionLimiter {
  const counts = new Map<string, { date: string; used: number }>();
  let hydrated: string | undefined;

  const write = (actor: string, date: string, used: number) => {
    void persistence?.save(actor, date, used).catch(() => {});
  };

  return {
    tryConsume(actor, asOf) {
      const entry = counts.get(actor);
      if (!entry || entry.date !== asOf) {
        counts.set(actor, { date: asOf, used: 1 });
        write(actor, asOf, 1);
        return true;
      }
      if (entry.used >= QUESTIONS_PER_DAY) return false;
      entry.used += 1;
      write(actor, asOf, entry.used);
      return true;
    },
    remaining(actor, asOf) {
      const entry = counts.get(actor);
      if (!entry || entry.date !== asOf) return QUESTIONS_PER_DAY;
      return Math.max(0, QUESTIONS_PER_DAY - entry.used);
    },
    async load(asOf) {
      if (!persistence || hydrated === asOf) return;
      hydrated = asOf;
      for (const row of await persistence.loadFor(asOf)) {
        // Memory wins if something was already consumed this process — a
        // hydration must never hand back an allowance already spent.
        const current = counts.get(row.actor);
        if (current?.date === asOf && current.used >= row.used) continue;
        counts.set(row.actor, { date: asOf, used: row.used });
      }
    },
  };
}
