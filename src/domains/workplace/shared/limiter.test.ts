import { describe, it, expect } from "vitest";
import {
  createQuestionLimiter,
  DEFAULT_QUESTIONS_PER_DAY,
  QUESTIONS_PER_DAY,
  type QuestionLimiterPersistence,
} from "./limiter";

/**
 * The allowance, now that it is a setting rather than a constant.
 *
 * What it governs is the thing worth being precise about: **interruptions are
 * capped, conversation you started is not.** That split is not new — the
 * allowance has only ever been spent by `recordMissReason` and
 * `utility.capture`, both unprompted, and `/api/assistant/ask` has never
 * touched it. Phase 2 changed the number and made it configurable, nothing
 * else.
 */

class FakeBudget implements QuestionLimiterPersistence {
  rows = new Map<string, number>();
  async save(actor: string, date: string, used: number) {
    this.rows.set(`${actor}:${date}`, used);
  }
  async loadFor(date: string) {
    return [...this.rows.entries()]
      .filter(([k]) => k.endsWith(`:${date}`))
      .map(([k, used]) => ({ actor: k.split(":")[0], used }));
  }
}

const DAY = "2026-08-08";

describe("the default is six", () => {
  it("allows six unprompted questions, then stops", () => {
    const limiter = createQuestionLimiter();
    expect(limiter.capFor("james")).toBe(DEFAULT_QUESTIONS_PER_DAY);
    expect(DEFAULT_QUESTIONS_PER_DAY).toBe(6);
    for (let i = 0; i < 6; i += 1) {
      expect(limiter.tryConsume("james", DAY), `question ${i + 1} should be allowed`).toBe(true);
    }
    expect(limiter.tryConsume("james", DAY)).toBe(false);
    expect(limiter.remaining("james", DAY)).toBe(0);
  });

  it("keeps the old number as a named constant, since it is still what 2 meant", () => {
    expect(QUESTIONS_PER_DAY).toBe(2);
  });

  it("a new day starts full", () => {
    const limiter = createQuestionLimiter();
    for (let i = 0; i < 6; i += 1) limiter.tryConsume("james", DAY);
    expect(limiter.remaining("james", DAY)).toBe(0);
    expect(limiter.remaining("james", "2026-08-09")).toBe(6);
  });
});

describe("per-person overrides", () => {
  it("honours a narrower allowance", () => {
    const limiter = createQuestionLimiter();
    limiter.setCapFor("priya", 2);
    expect(limiter.capFor("priya")).toBe(2);
    expect(limiter.tryConsume("priya", DAY)).toBe(true);
    expect(limiter.tryConsume("priya", DAY)).toBe(true);
    expect(limiter.tryConsume("priya", DAY)).toBe(false);
    // And nobody else is affected.
    expect(limiter.capFor("james")).toBe(6);
  });

  it("honours a wider one", () => {
    const limiter = createQuestionLimiter();
    limiter.setCapFor("shruti", 10);
    for (let i = 0; i < 10; i += 1) expect(limiter.tryConsume("shruti", DAY)).toBe(true);
    expect(limiter.tryConsume("shruti", DAY)).toBe(false);
  });

  it("zero means never interrupt me", () => {
    // A legitimate setting, not a misconfiguration to be clamped up to one.
    const limiter = createQuestionLimiter();
    limiter.setCapFor("james", 0);
    expect(limiter.tryConsume("james", DAY)).toBe(false);
    expect(limiter.remaining("james", DAY)).toBe(0);
  });

  it("a negative or fractional setting is coerced, not honoured literally", () => {
    const limiter = createQuestionLimiter();
    limiter.setCapFor("james", -5);
    expect(limiter.capFor("james")).toBe(0);
    limiter.setCapFor("priya", 3.7);
    expect(limiter.capFor("priya")).toBe(3);
  });
});

describe("what is spent is durable; the cap is not", () => {
  /**
   * Deliberately different lifetimes. How many questions somebody has had today
   * is a fact about today and must survive a restart. Their cap is a setting —
   * and if it were restored from the same place, a restart could silently widen
   * an allowance somebody had narrowed.
   */
  it("a spent allowance survives a restart", async () => {
    const budget = new FakeBudget();
    const before = createQuestionLimiter(budget);
    before.tryConsume("james", DAY);
    before.tryConsume("james", DAY);
    await new Promise((r) => setTimeout(r, 10));

    const after = createQuestionLimiter(budget);
    await after.load(DAY);
    expect(after.remaining("james", DAY)).toBe(4);
  });

  it("a narrowed cap plus a spent allowance still refuses after a restart", async () => {
    const budget = new FakeBudget();
    const before = createQuestionLimiter(budget);
    before.setCapFor("james", 2);
    before.tryConsume("james", DAY);
    before.tryConsume("james", DAY);
    await new Promise((r) => setTimeout(r, 10));

    const after = createQuestionLimiter(budget);
    after.setCapFor("james", 2);
    await after.load(DAY);
    expect(after.remaining("james", DAY)).toBe(0);
    expect(after.tryConsume("james", DAY)).toBe(false);
  });

  it("hydrating never hands back an allowance already spent this process", async () => {
    const budget = new FakeBudget();
    await budget.save("james", DAY, 1);
    const limiter = createQuestionLimiter(budget);
    limiter.tryConsume("james", DAY);
    limiter.tryConsume("james", DAY);
    limiter.tryConsume("james", DAY);
    await limiter.load(DAY);
    // Three spent this process beats the one on disk.
    expect(limiter.remaining("james", DAY)).toBe(3);
  });
});

describe("conversation you started is not capped", () => {
  it("the assistant endpoint does not touch the limiter", async () => {
    // Asserted against the source rather than by exhausting an allowance,
    // because the property is "this code path never calls it" — which an
    // absence of calls is the only honest way to show.
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("src/app/api/assistant/ask/route.ts", "utf8");
    const agent = readFileSync("src/domains/assistant/agent.ts", "utf8");
    for (const src of [route, agent]) {
      expect(src).not.toContain("tryConsume");
      expect(src).not.toContain("QuestionLimiter");
    }
  });

  it("only the two unprompted callers spend it", async () => {
    // Walked rather than shelled out to grep. `execSync` goes through cmd.exe
    // on Windows, where there is no grep, so the shell version failed for a
    // reason with nothing to do with the property being tested — and passed or
    // failed depending on which shell happened to be inherited.
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = `${dir}/${entry}`;
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith(".ts") || full.endsWith(".test.ts")) continue;
        if (full.endsWith("shared/limiter.ts")) continue;
        if (readFileSync(full, "utf8").includes("tryConsume")) hits.push(full);
      }
    };
    walk("src");
    // Exactly two, and both are the assistant interrupting somebody rather than
    // answering them. A third would mean the split has quietly moved.
    expect(hits.sort()).toEqual([
      "src/domains/assistant/day-plan/service.ts",
      "src/domains/workplace/utilities.ts",
    ]);
  });
});
