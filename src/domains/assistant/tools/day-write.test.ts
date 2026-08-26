import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { setFakeLlmScript, fakeLlmCalls, resetFakeLlm } from "@/config/llm-fake";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { CourseService } from "@/domains/course/service";
import { DayPlanService } from "@/domains/assistant/day-plan/service";
import { DayPlanStore } from "@/domains/assistant/day-plan/store";
import { openDay } from "@/domains/assistant/day-plan/test-support";
import { ask } from "../agent";
import { toolsFor, type ToolDeps } from "./index";
import { resetTokenBudget } from "../token-budget";

/**
 * The six tools that write — and the boundaries they must not cross.
 */

const TODAY = "2026-08-08";
const ROLES = ["superadmin", "admin", "shruti", "james", "priya", "ravi"] as const;

let world: DemoWorld;
let deps: ToolDeps;
let dayPlan: DayPlanService;
let store: DayPlanStore;

beforeEach(async () => {
  process.env.ORG_LLM_PROVIDER = "fake";
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetTokenBudget();
  world = await buildDemoWorld();
  store = new DayPlanStore();
  dayPlan = new DayPlanService(store, {
    graph: world.deps.graph,
    limiter: createQuestionLimiter(),
    actorLookup: () => ({ spine: world.spine }),
  });
  deps = {
    spine: world.spine,
    graph: world.deps.graph,
    figures: world.deps.figures,
    permissions: world.deps.permissions,
    courses: new CourseService(world.deps.graph, world.deps.figures),
    dayPlan,
    today: () => TODAY,
  };
});

afterEach(() => {
  delete process.env.ORG_LLM_PROVIDER;
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
});

async function run(actor: string, name: string, input: unknown = {}) {
  const { tools } = toolsFor(actor, deps);
  const t = tools[name];
  if (!t) return undefined;
  const execute = t.execute as (i: unknown, o: unknown) => Promise<unknown>;
  const out = (await execute(input, { toolCallId: "t", messages: [] })) as {
    untrusted_record_data: Record<string, unknown>;
  };
  return out.untrusted_record_data;
}

/**
 * The two-call read-back, walked the way the model must walk it.
 *
 * `confirmed: true` used to be enough on its own — which was the hole Part B
 * closed. The token comes from the FIRST call and the server checks it, so a
 * test cannot short-circuit this any more than the model can.
 */
async function confirmAndRun(
  actor: string,
  name: string,
  input: Record<string, unknown>,
) {
  const first = await run(actor, name, input);
  const token = first?.confirmationToken;
  if (!token) return first;
  return run(actor, name, { ...input, confirmationToken: token });
}

describe("own day only — the A8 line, from the write side", () => {
  /**
   * A8 is usually argued about on the read side (`team_day`'s four fields).
   * It has a write side too, and it is simpler: there is no way to name
   * somebody else. Not "it refuses" — there is nowhere to put the name.
   */
  it("no write tool takes a person, for any role", () => {
    const WRITES = ["select_item", "commit_plan", "mark_done", "drop_item", "carry_over", "close_out"];
    for (const actor of ROLES) {
      const { tools } = toolsFor(actor, deps);
      for (const name of WRITES) {
        const schema = JSON.stringify((tools[name] as { inputSchema?: unknown }).inputSchema);
        expect(schema, `${name} must not accept a person`).not.toContain("person");
        expect(schema, `${name} must not accept an actor`).not.toContain("actor");
        expect(schema, `${name} must not accept an employee`).not.toContain("employee");
      }
    }
  });

  it("writes land on the caller's own day, whoever is asking", async () => {
    // A distinct label each, so "did this land on the wrong plan?" is
    // answerable rather than confounded by everyone adding the same thing.
    const people = ["james", "priya", "ravi"] as const;
    for (const actor of people) {
      await openDay(dayPlan, actor, TODAY);
      const added = await run(actor, "select_item", {
        label: `Only ${actor}`,
        estimateMinutes: 30,
      });
      expect(added?.ok).toBe(true);
    }
    for (const actor of people) {
      const labels = store.get(actor, TODAY)!.plan.map((p) => p.label);
      expect(labels).toContain(`Only ${actor}`);
      for (const other of people.filter((o) => o !== actor)) {
        expect(labels, `${other}'s item must not be on ${actor}'s plan`).not.toContain(
          `Only ${other}`,
        );
      }
    }
  });

  it("a manager cannot write to a report's day even by trying", async () => {
    await openDay(dayPlan, "priya", TODAY);
    // The model tries to name somebody. There is nowhere to put it, and the
    // extra keys are simply ignored by the schema.
    await run("james", "select_item", {
      label: "Injected",
      estimateMinutes: 30,
      person: "priya",
      actor: "priya",
    });
    expect(store.get("priya", TODAY)!.plan.map((p) => p.label)).not.toContain("Injected");
  });
});

describe("the chase for a missing time is ONE rule, in the service", () => {
  it("select_item surfaces the service's refusal rather than pre-empting it", async () => {
    await openDay(dayPlan, "james", TODAY);
    const out = await run("james", "select_item", { label: "Module 4" });
    expect(out?.ok).toBe(false);
    expect(out?.needsAnswer).toBe(true);
    // The wording comes from `selectItem`, not from the tool.
    expect(String(out?.question)).toMatch(/time for each item is required/i);
  });

  it("the model calls the tool rather than refusing on its own", async () => {
    await openDay(dayPlan, "james", TODAY);
    setFakeLlmScript([
      // A timeless item. The model must still CALL — if it enforced the rule
      // itself there would be two rules that can drift apart.
      { toolCalls: [{ toolName: "select_item", input: { label: "Module 4" } }] },
      { text: "How long do you think Module 4 will take?" },
    ]);
    const result = await ask({ actor: "james", question: "Put Module 4 on today", deps });
    expect(fakeLlmCalls().map((c) => c.toolName)).toContain("select_item");
    expect(result.answer).toMatch(/how long/i);
  });

  it("the prompt does not carry a duplicate time rule", async () => {
    const { ASSISTANT_SYSTEM_PROMPT } = await import("../agent");
    // If the rule were in the prompt too, the model could enforce a version of
    // it that drifts from the service's.
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(/time (estimate )?is required/i);
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(/must have an estimate/i);
  });

  it("accepts the item once a time is given", async () => {
    await openDay(dayPlan, "james", TODAY);
    const out = await run("james", "select_item", { label: "Module 4", estimateMinutes: 60 });
    expect(out?.ok).toBe(true);
    expect((out?.added as { estimateMinutes: number }).estimateMinutes).toBe(60);
  });
});

describe("drop is not a miss", () => {
  it("reads back before it will do anything", async () => {
    await openDay(dayPlan, "james", TODAY);
    const added = await run("james", "select_item", { label: "Module 4", estimateMinutes: 60 });
    const id = (added?.added as { id: string }).id;

    const unconfirmed = await run("james", "drop_item", { itemId: id });
    expect(unconfirmed?.ok).toBe(false);
    expect(unconfirmed?.needsConfirmation).toBe(true);
    // The first call hands back a token rather than acting on a claim.
    expect(unconfirmed?.confirmationToken).toBeTruthy();
    // And nothing happened.
    expect(store.get("james", TODAY)!.plan[0].dropped).toBeUndefined();
  });

  it("does not break the streak", async () => {
    await openDay(dayPlan, "james", TODAY);
    const keep = await run("james", "select_item", { label: "Keep", estimateMinutes: 60 });
    const drop = await run("james", "select_item", { label: "Drop", estimateMinutes: 60 });
    await run("james", "commit_plan", {});
    await dayPlan.tick("james", TODAY, (keep?.added as { id: string }).id, { actualMinutes: 60 });

    const out = await confirmAndRun("james", "drop_item", {
      itemId: (drop?.added as { id: string }).id,
    });
    expect(out?.ok).toBe(true);
    expect(String(out?.streakEffect)).toMatch(/does not break/i);

    dayPlan.finishCloseOut("james", TODAY);
    expect(store.streakFor("james").clean).toBe(1);
  });
});

describe("carry-over does NOT make the day clean", () => {
  /**
   * The trap the plan spells out. If carrying over excused an item, tapping it
   * on everything would make every day clean and the streak would be worthless.
   * What it actually means is: it does not BREAK the streak, and it comes back
   * tomorrow.
   */
  it("the day is still not clean", async () => {
    await openDay(dayPlan, "james", TODAY);
    const item = await run("james", "select_item", { label: "Module 4", estimateMinutes: 60 });
    await run("james", "commit_plan", {});
    await run("james", "carry_over", { itemId: (item?.added as { id: string }).id });

    dayPlan.finishCloseOut("james", TODAY);
    // A7: clean means everything committed was finished within its time.
    expect(store.streakFor("james").clean).toBe(0);
  });

  it("the tool says so in the result, so the sentence cannot get it wrong", async () => {
    await openDay(dayPlan, "james", TODAY);
    const item = await run("james", "select_item", { label: "Module 4", estimateMinutes: 60 });
    const out = await run("james", "carry_over", { itemId: (item?.added as { id: string }).id });
    expect(out?.dayStillCounted).toBe(false);
    expect(String(out?.note)).toMatch(/do not say the day is still clean/i);
  });

  it("but it does not break a streak either", async () => {
    // Day one clean.
    await openDay(dayPlan, "james", "2026-08-07");
    const first = dayPlan.selectItem("james", "2026-08-07", { label: "A", estimateMinutes: 60 });
    await dayPlan.tick("james", "2026-08-07", first.item!.id, { actualMinutes: 60 });
    dayPlan.finishCloseOut("james", "2026-08-07");
    expect(store.streakFor("james").clean).toBe(1);

    // Day two carried over — held, not lost.
    await openDay(dayPlan, "james", TODAY);
    const item = await run("james", "select_item", { label: "B", estimateMinutes: 60 });
    await run("james", "carry_over", { itemId: (item?.added as { id: string }).id });
    dayPlan.finishCloseOut("james", TODAY);
    expect(store.streakFor("james").clean).toBe(1);
  });
});

describe("close_out is two calls, in order", () => {
  it("begin does not assess the day", async () => {
    await openDay(dayPlan, "james", TODAY);
    const item = await run("james", "select_item", { label: "A", estimateMinutes: 60 });
    await run("james", "commit_plan", {});
    await dayPlan.tick("james", TODAY, (item?.added as { id: string }).id, { actualMinutes: 60 });

    const begun = await run("james", "close_out", { step: "begin" });
    expect(begun?.ok).toBe(true);
    // The trap: `finalizeDay` is idempotent, so assessing here would mean every
    // answer that follows arrives too late and the conversation is theatre.
    expect(store.streakFor("james").lastAssessedDate).toBeUndefined();
  });

  it("finish refuses without a read-back", async () => {
    await openDay(dayPlan, "james", TODAY);
    await run("james", "close_out", { step: "begin" });
    const out = await run("james", "close_out", { step: "finish" });
    expect(out?.ok).toBe(false);
    expect(out?.needsConfirmation).toBe(true);
    expect(store.streakFor("james").lastAssessedDate).toBeUndefined();
  });

  it("an answer given between begin and finish still changes the outcome", async () => {
    await openDay(dayPlan, "james", TODAY);
    const done = await run("james", "select_item", { label: "A", estimateMinutes: 60 });
    const open = await run("james", "select_item", { label: "B", estimateMinutes: 60 });
    await run("james", "commit_plan", {});
    await dayPlan.tick("james", TODAY, (done?.added as { id: string }).id, { actualMinutes: 60 });

    await run("james", "close_out", { step: "begin" });
    // Answered DURING the conversation — this is the whole point of two steps.
    await confirmAndRun("james", "drop_item", {
      itemId: (open?.added as { id: string }).id,
    });
    await confirmAndRun("james", "close_out", { step: "finish" });

    // Dropped work is excused, so the day came out clean because of an answer
    // given after `begin`. Assessing on begin would have scored it a 0.
    expect(store.streakFor("james").clean).toBe(1);
  });

  it("finish folds the day in, once", async () => {
    await openDay(dayPlan, "james", TODAY);
    const item = await run("james", "select_item", { label: "A", estimateMinutes: 60 });
    await run("james", "commit_plan", {});
    await dayPlan.tick("james", TODAY, (item?.added as { id: string }).id, { actualMinutes: 60 });
    await run("james", "close_out", { step: "begin" });
    // Three finishes, each walking the two-call protocol properly, so this is
    // testing idempotence rather than testing the gate.
    await confirmAndRun("james", "close_out", { step: "finish" });
    await confirmAndRun("james", "close_out", { step: "finish" });
    await confirmAndRun("james", "close_out", { step: "finish" });
    expect(store.streakFor("james").clean).toBe(1);
  });
});

describe("the service keeps its judgement", () => {
  it("mark_done returns the verdict rather than leaving it to the model", async () => {
    await openDay(dayPlan, "james", TODAY);
    const item = dayPlan.selectItem("james", TODAY, {
      label: "Module 4",
      estimateMinutes: 60,
      start: "2026-08-08T11:00:00Z",
      end: "2026-08-08T12:00:00Z",
    });
    dayPlan.commitPlan("james", TODAY);
    // A meeting sat in the window: `classifyMiss` should call it interrupted.
    dayPlan.arriveDuringDay("james", TODAY, {
      id: "m1",
      title: "Review",
      start: "2026-08-08T11:00:00Z",
      end: "2026-08-08T12:00:00Z",
    });
    const out = await run("james", "mark_done", {
      itemId: item.item!.id,
      actualMinutes: 180,
    });
    expect(out?.missKind).toBe("interrupted");
    expect(String(out?.note)).toMatch(/do not re-decide it/i);
  });

  it("its description forbids the model deciding an interruption", () => {
    const { tools } = toolsFor("james", deps);
    const d = String((tools.mark_done as { description?: string }).description);
    expect(d).toMatch(/NOT YOURS TO DECIDE/i);
    expect(d).toMatch(/never call something interrupted because they said it felt like it/i);
  });
});

describe("a free-text morning maps onto the tools", () => {
  /**
   * ⚠ **This script gained a hop in Phase 4.5, and nothing else about it moved.**
   *
   * The day's writes now live in the `day` specialist beside `my_day`, so the
   * coordinator reaches them with `delegate_action` instead of holding them.
   * The three assertions below are the ones that were here before, unchanged:
   * three items selected, the plan committed, the day `planned`.
   *
   * That `result.calls` still contains `select_item` is the point of
   * `onToolCall` in `fanout.ts` — the transcript reports what actually ran, not
   * which agent was holding the tool when it ran. Without that, this test would
   * have had to be weakened to `["delegate_action"]`, and every selection score
   * this project has ever recorded would have stopped being comparable.
   */
  it("three things named in one sentence become three select_item calls", async () => {
    await openDay(dayPlan, "james", TODAY);
    setFakeLlmScript([
      // The coordinator routes it. One area, one call.
      {
        toolCalls: [
          {
            toolName: "delegate_action",
            input: {
              domain: "day",
              instruction:
                "Add Module 4 (60 minutes), Arun prep (30 minutes) and Priya's leave (15 minutes), then commit the plan.",
            },
          },
        ],
      },
      // ── inside the `day` specialist ──
      {
        toolCalls: [
          { toolName: "select_item", input: { label: "Module 4", estimateMinutes: 60 } },
          { toolName: "select_item", input: { label: "Arun prep", estimateMinutes: 30 } },
          { toolName: "select_item", input: { label: "Priya's leave", estimateMinutes: 15 } },
        ],
      },
      { toolCalls: [{ toolName: "commit_plan", input: {} }] },
      { text: "Added all three and committed the plan." },
      // ── back on the coordinator ──
      { text: "Committed: Module 4, Arun prep and Priya's leave. That's 1h 45m." },
    ]);
    const result = await ask({
      actor: "james",
      question: "Module 4 for an hour, half an hour on the Arun prep, and 15 minutes on Priya's leave. That's it.",
      deps,
    });
    expect(result.calls.filter((c) => c === "select_item")).toHaveLength(3);
    expect(result.calls).toContain("commit_plan");
    expect(store.get("james", TODAY)!.phase).toBe("planned");
  });
});
