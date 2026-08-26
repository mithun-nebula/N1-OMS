import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { setFakeLlmScript, resetFakeLlm } from "@/config/llm-fake";
import { CourseService } from "@/domains/course/service";
import { ask } from "./agent";
import { toolsFor, DEFAULT_CAP, type ToolDeps } from "./tools";
import { seedManyTasks, CAP_FIXTURE_ROWS } from "./tools/fixtures";
import { resetTokenBudget } from "./token-budget";

/**
 * The cap, exercised by a question rather than by a unit test.
 *
 * 1a shipped `truncated` and never saw it fire against a real question — the
 * demo organisation is too small to reach twenty of anything. That left the
 * interesting half untested: not whether `shape()` sets the flag (it does), but
 * whether the answer that comes back admits the list is partial.
 *
 * The failure this guards against is quiet. Twenty rows are genuinely present,
 * so "you have 20 tasks" reads exactly like a true answer to anyone who does
 * not already know there are a hundred.
 */

let world: DemoWorld;
let deps: ToolDeps;

beforeEach(async () => {
  process.env.ORG_LLM_PROVIDER = "fake";
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetTokenBudget();
  world = await buildDemoWorld();
  deps = {
    spine: world.spine,
    graph: world.deps.graph,
    figures: world.deps.figures,
    permissions: world.deps.permissions,
    courses: new CourseService(world.deps.graph, world.deps.figures),
    today: () => "2026-08-08",
  };
  await seedManyTasks(world.deps.graph);
});

afterEach(() => {
  delete process.env.ORG_LLM_PROVIDER;
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
});

/** Run one tool directly and unwrap the untrusted envelope. */
async function runTool(actor: string, name: string, input: unknown) {
  const { tools } = toolsFor(actor, deps);
  const execute = tools[name].execute as (i: unknown, o: unknown) => Promise<unknown>;
  const out = (await execute(input, { toolCallId: "t", messages: [] })) as {
    untrusted_record_data: {
      items: unknown[];
      total: number;
      truncated: boolean;
      note?: string;
    };
  };
  return out.untrusted_record_data;
}

describe("the cap, against a hundred rows", () => {
  it("shows exactly the cap and reports the real total", async () => {
    // Asked as HR, who sees the whole board. See `fixtures.ts` on why a
    // manager would not reach the cap here, and why that is the gate working.
    const out = await runTool("shruti", "list_tasks", {});
    expect(out.items).toHaveLength(DEFAULT_CAP);
    expect(out.total).toBeGreaterThanOrEqual(CAP_FIXTURE_ROWS);
    // The number that matters: the real one, not the shown one.
    expect(out.total).not.toBe(DEFAULT_CAP);
    expect(out.truncated).toBe(true);
  });

  it("carries a note, and the note forbids the exact wrong answer", async () => {
    const out = await runTool("shruti", "list_tasks", {});
    expect(out.note).toBeTruthy();
    // Two things it must do: give the real proportion, and say plainly that
    // this is not the whole list. The second is the one the model can act on.
    expect(out.note).toContain(String(out.total));
    expect(out.note).toMatch(/not the (complete|full|whole) list|do not describe this as the full list/i);
  });

  it("the agent surfaces truncation to its caller", async () => {
    setFakeLlmScript([
      { toolCalls: [{ toolName: "list_tasks", input: {} }] },
      { text: "Here are some of the tasks on the board." },
    ]);
    const result = await ask({ actor: "shruti", question: "What is on the board?", deps });
    expect(result.truncated).toBe(true);
  });

  it("says nothing about truncation when the answer is complete", async () => {
    // A narrow question fits inside the cap, and must not be hedged.
    const out = await runTool("shruti", "list_tasks", { courseId: "no-such-course" });
    expect(out.truncated).toBe(false);
    expect(out.note).toBeUndefined();
  });
});
