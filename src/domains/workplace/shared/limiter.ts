export interface QuestionLimiter {
  tryConsume(actor: string, asOf: string): boolean;
  remaining(actor: string, asOf: string): number;
  /**
   * Pull today's counts back from durable storage. Awaited once at boot; a
   * no-op when the limiter is memory-only, as it is in every test.
   */
  load(asOf: string): Promise<void>;
  /** This person's daily allowance — per-actor, defaulting to `DEFAULT_QUESTIONS_PER_DAY`. */
  capFor(actor: string): number;
  /** Set one person's allowance. A setting, not a fact about today — see below. */
  setCapFor(actor: string, cap: number): void;
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

/**
 * The old fixed cap.
 *
 * Kept as a named constant rather than deleted: two durability tests assert
 * this exact number, and it is the honest record of what the limit used to be.
 */
export const QUESTIONS_PER_DAY = 2;

/**
 * The allowance now, unless somebody's setting says otherwise.
 *
 * ── What this governs, and what it does not ─────────────────────────────────
 *
 * - **Interruptions** — the assistant pinging you unasked — are **capped**.
 * - **Conversation you started** is **uncapped, and always has been.**
 *
 * That split is not new; it is already how the code behaves. The allowance is
 * spent in exactly two places — `recordMissReason` (the overrun question) and
 * `utility.capture` — and both are unprompted. `/api/assistant/ask` has never
 * touched the limiter, so asking the assistant something has always been free.
 * Only the number and its configurability change here.
 *
 * ── Why six ─────────────────────────────────────────────────────────────────
 *
 * Neither number is knowable before anyone has lived with it, so it is tunable
 * and we find out. Six is roughly one every ninety minutes — enough to catch a
 * real overrun or a commitment, few enough that a person still looks up when it
 * pings. Thirty would be one every sixteen minutes, which is the thing people
 * mute inside a week.
 *
 * **The bar matters more than the number.** A question earns its place only
 * when the answer changes something: an estimate the system will learn from, a
 * commitment it will follow up, a plan it will re-order. Held to that bar the
 * scheduler lands near three to five a day on its own and this cap never fires.
 * It is a backstop for when the judgement is wrong, not the design.
 */
export const DEFAULT_QUESTIONS_PER_DAY = 6;

/**
 * At most a few questions per person per day — the limit that "applies
 * everywhere in the application" (appendix A4), shared deliberately between the
 * day-plan's overrun question and `utility.capture`. One budget is the spec:
 * the point is that nobody is over-questioned in total, not that each feature
 * gets its own ration.
 *
 * Without persistence the counts lived in a `Map` pinned to `globalThis`, so
 * every restart or redeploy handed everyone a fresh allowance and the promise
 * was quietly broken.
 *
 * **What is spent is durable; the cap is not.** How many questions somebody has
 * already had today is a fact about today and survives a restart. Their cap is
 * a setting. Storing the two the same way would mean a restart could silently
 * widen an allowance somebody had deliberately narrowed.
 */
export function createQuestionLimiter(
  persistence?: QuestionLimiterPersistence,
  options: { defaultCap?: number } = {},
): QuestionLimiter {
  const counts = new Map<string, { date: string; used: number }>();
  const caps = new Map<string, number>();
  const defaultCap = options.defaultCap ?? DEFAULT_QUESTIONS_PER_DAY;
  let hydrated: string | undefined;

  const write = (actor: string, date: string, used: number) => {
    void persistence?.save(actor, date, used).catch(() => {});
  };

  const capFor = (actor: string) => caps.get(actor) ?? defaultCap;

  return {
    capFor,
    setCapFor(actor, cap) {
      // Zero is a legitimate setting: "never interrupt me".
      caps.set(actor, Math.max(0, Math.floor(cap)));
    },
    tryConsume(actor, asOf) {
      const cap = capFor(actor);
      if (cap <= 0) return false;
      const entry = counts.get(actor);
      if (!entry || entry.date !== asOf) {
        counts.set(actor, { date: asOf, used: 1 });
        write(actor, asOf, 1);
        return true;
      }
      if (entry.used >= cap) return false;
      entry.used += 1;
      write(actor, asOf, entry.used);
      return true;
    },
    remaining(actor, asOf) {
      const cap = capFor(actor);
      const entry = counts.get(actor);
      if (!entry || entry.date !== asOf) return cap;
      return Math.max(0, cap - entry.used);
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
