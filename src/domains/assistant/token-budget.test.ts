import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  DAILY_TOKEN_CEILING,
  estimateMessageTokens,
  estimateTokens,
  estimateToolTokens,
  resetTokenBudget,
  setTokenBudgetPersistence,
  spendTokens,
  tokenBudgetLeft,
  type TokenBudgetPersistence,
} from "./token-budget";

/**
 * The daily ceiling, and the two things Phase 4.6 changed about it.
 *
 *  1. **It lived in a `Map`.** One server was fine; two each believed nothing
 *     had been spent, so the ceiling silently became two ceilings — and
 *     nothing reported it.
 *  2. **Nothing counted a prompt before sending it.** Cost was charged from
 *     `result.usage`, afterwards, which is the wrong end of the request for
 *     deciding how much conversation to send.
 */

/** One shared table, two processes — which is the case the `Map` got wrong. */
function sharedStore(): TokenBudgetPersistence & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  return {
    rows,
    async spentOn(actor, date) {
      return rows.get(`${actor}:${date}`) ?? 0;
    },
    async add(actor, date, tokens) {
      const key = `${actor}:${date}`;
      // The addition happens inside the store, atomically — never read-then-
      // write by the caller, which is the same race in a different place.
      const next = (rows.get(key) ?? 0) + tokens;
      rows.set(key, next);
      return next;
    },
  };
}

beforeEach(() => resetTokenBudget());
afterEach(() => resetTokenBudget());

describe("⚠ two processes now share one budget", () => {
  it("what one server spent, the other can see", async () => {
    const shared = sharedStore();

    // Server A.
    setTokenBudgetPersistence(shared);
    await spendTokens("hr-004", "2026-08-26", 400_000);

    // Server B — a different process, so a fresh in-memory map.
    resetTokenBudget();
    setTokenBudgetPersistence(shared);

    expect(await tokenBudgetLeft("hr-004", "2026-08-26")).toBe(DAILY_TOKEN_CEILING - 400_000);
  });

  it("two servers spending the same amount spend it twice, not once", async () => {
    // ⚠ The reason the conflict clause ADDS rather than taking GREATEST. Under
    // GREATEST both of these would record 100,000 and half the spend would
    // vanish — which is the multiplying ceiling this change exists to fix.
    const shared = sharedStore();

    setTokenBudgetPersistence(shared);
    await spendTokens("hr-004", "2026-08-26", 100_000);
    resetTokenBudget();
    setTokenBudgetPersistence(shared);
    await spendTokens("hr-004", "2026-08-26", 100_000);

    expect(await tokenBudgetLeft("hr-004", "2026-08-26")).toBe(DAILY_TOKEN_CEILING - 200_000);
  });

  it("the ceiling survives a restart — the behaviour that deliberately changed", async () => {
    const shared = sharedStore();
    setTokenBudgetPersistence(shared);
    await spendTokens("hr-004", "2026-08-26", DAILY_TOKEN_CEILING);
    expect(await tokenBudgetLeft("hr-004", "2026-08-26")).toBe(0);

    // Restart: everything in memory is gone.
    resetTokenBudget();
    setTokenBudgetPersistence(shared);
    // It used to forgive here, and `token-budget.ts` said that was preferred.
    // It no longer does, and the file now says why.
    expect(await tokenBudgetLeft("hr-004", "2026-08-26")).toBe(0);
  });

  it("yesterday's spend does not count against today", async () => {
    const shared = sharedStore();
    setTokenBudgetPersistence(shared);
    await spendTokens("hr-004", "2026-08-25", DAILY_TOKEN_CEILING);
    expect(await tokenBudgetLeft("hr-004", "2026-08-26")).toBe(DAILY_TOKEN_CEILING);
    // And the row is still there — nothing is deleted on the write path.
    expect(shared.rows.get("hr-004:2026-08-25")).toBe(DAILY_TOKEN_CEILING);
  });

  it("one person's spend is not another's", async () => {
    const shared = sharedStore();
    setTokenBudgetPersistence(shared);
    await spendTokens("hr-004", "2026-08-26", DAILY_TOKEN_CEILING);
    expect(await tokenBudgetLeft("hr-005", "2026-08-26")).toBe(DAILY_TOKEN_CEILING);
  });
});

describe("⚠ a database outage must not become an assistant outage", () => {
  const broken: TokenBudgetPersistence = {
    async spentOn() {
      throw new Error("no database");
    },
    async add() {
      throw new Error("no database");
    },
  };

  it("fails open, back to exactly the old in-memory behaviour", async () => {
    setTokenBudgetPersistence(broken);
    expect(await tokenBudgetLeft("hr-004", "2026-08-26")).toBe(DAILY_TOKEN_CEILING);
    await spendTokens("hr-004", "2026-08-26", 500_000);
    // Still counted, in this process — a question is not free just because the
    // database is unreachable.
    expect(await tokenBudgetLeft("hr-004", "2026-08-26")).toBe(DAILY_TOKEN_CEILING - 500_000);
  });
});

describe("⚠ a prompt's size is known before it is sent", () => {
  it("estimates text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("x".repeat(400))).toBe(100);
  });

  it("charges a message for existing, not only for its content", () => {
    // A hundred empty messages are not free, and an estimate that says they
    // are will under-count exactly the conversation this phase switched on.
    expect(estimateMessageTokens([{ role: "user", content: "" }])).toBeGreaterThan(0);
  });

  it("counts the tool definitions, which are the largest item", () => {
    const tools = {
      my_day: { description: "x".repeat(400), inputSchema: { shape: {} } },
    };
    expect(estimateToolTokens(tools)).toBeGreaterThanOrEqual(100);
    expect(estimateToolTokens({})).toBe(0);
  });

  it("survives a schema that will not serialise", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      estimateToolTokens({ t: { description: "d", inputSchema: { shape: circular } } }),
    ).not.toThrow();
  });

  it("the agent checks the estimate before calling the model", () => {
    // Asserted against the source, because the property is an ORDER — the
    // count happens on the near side of `agent.generate`, and that is the
    // whole point of it.
    const src = readFileSync("src/domains/assistant/agent.ts", "utf8");
    const counted = src.indexOf("const preSend =");
    const sent = src.indexOf("await agent.generate(");
    expect(counted).toBeGreaterThan(0);
    expect(sent).toBeGreaterThan(counted);
  });

  it("the estimate includes the tools, the instructions and the history", () => {
    const src = readFileSync("src/domains/assistant/agent.ts", "utf8");
    const preSend = src.slice(src.indexOf("const preSend ="), src.indexOf("if (preSend > left)"));
    expect(preSend).toContain("estimateToolTokens");
    expect(preSend).toContain("estimateTokens(instructions)");
    expect(preSend).toContain("estimateMessageTokens(messages)");
  });
});
