import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { CourseService } from "@/domains/course/service";
import { ToolContext, type ToolDeps } from "./tools/context";
import { ALL_TOOLS } from "./tools";
import { DOMAINS, toolsForDomain, coordinatorToolNames } from "./specialists/domains";
import { DAILY_TOKEN_CEILING } from "./token-budget";

/**
 * What the catalogue costs on every single call.
 *
 * ── Why this is a test and not a note ───────────────────────────────────────
 *
 * **Every tool definition is sent with every request.** `token-budget.ts` was
 * sized against 15 tools, then 33. Phase 3 takes it to 102, and nothing had
 * re-checked it — so the first live run of Phase 3 exhausted a person's whole
 * daily allowance after **six questions**. Not six hundred. Six.
 *
 * That is not a limit anybody chose. It is arithmetic nobody had done.
 *
 * The numbers below are measured from the real schemas rather than estimated,
 * and pinned, so the next person to add twenty tools finds out here rather than
 * in front of somebody at eleven in the morning.
 *
 * ⚠ **Approximate, and honestly so.** Characters over four is the usual rule of
 * thumb for English text and it is what this uses. It is not the provider's
 * tokeniser and does not claim to be — what matters is the RATIO between the
 * coordinator's set and a specialist's, and that ratio is robust to the
 * approximation.
 */

let world: DemoWorld;
let deps: ToolDeps;

beforeEach(async () => {
  world = await buildDemoWorld();
  deps = {
    spine: world.spine,
    graph: world.deps.graph,
    figures: world.deps.figures,
    permissions: world.deps.permissions,
    courses: new CourseService(world.deps.graph, world.deps.figures),
    today: () => "2026-08-08",
  };
});

/** Roughly what a set of tool definitions costs to send. */
function costOf(names: readonly string[], actor = "superadmin"): number {
  const ctx = new ToolContext(actor, deps);
  let chars = 0;
  for (const spec of ALL_TOOLS) {
    if (!names.includes(spec.name)) continue;
    const built = spec.build(ctx) as { description?: string; inputSchema?: unknown };
    chars += (built.description ?? "").length;
    chars += spec.name.length;
    try {
      // The schema is what actually travels; its shape is what a provider
      // serialises. Stringifying the zod object is a stand-in for that, and it
      // scales with the same thing: how many fields, with what descriptions.
      chars += JSON.stringify(
        (built.inputSchema as { shape?: unknown })?.shape ?? {},
        (_k, v) => (typeof v === "function" ? undefined : v),
      ).length;
    } catch {
      /* a schema that will not serialise still costs its description */
    }
  }
  return Math.round(chars / 4);
}

describe("what the catalogue costs on every call", () => {
  it("reports the three numbers the phase must not guess at", () => {
    const all = ALL_TOOLS.map((t) => t.name);
    const coordinator = costOf(all);
    const perSpecialist = DOMAINS.map((d) => ({
      id: d.id,
      cost: costOf(toolsForDomain(d.id).map((t) => t.name)),
    }));
    const worstSpecialist = Math.max(...perSpecialist.map((p) => p.cost));
    const fanOutAll = perSpecialist.reduce((a, p) => a + p.cost, 0);

    // 1 · tokens per call, against 1b's 33-tool baseline.
    const readOnly = costOf(
      ALL_TOOLS.filter((t) => !isWrite(t.name)).map((t) => t.name),
    );

    console.log(
      JSON.stringify(
        {
          tools: all.length,
          coordinatorDefinitionTokens: coordinator,
          readOnlyDefinitionTokens: readOnly,
          worstSpecialistTokens: worstSpecialist,
          allTenSpecialistsTokens: fanOutAll,
          dailyCeiling: DAILY_TOKEN_CEILING,
          // 2 · does the ceiling still fit a working day of ~30 questions?
          questionsPerDayAtCoordinatorCost: Math.floor(DAILY_TOKEN_CEILING / coordinator),
          questionsPerDayIfReadOnly: Math.floor(DAILY_TOKEN_CEILING / readOnly),
          perSpecialist,
        },
        null,
        1,
      ),
    );

    // A specialist must stay small — that is the whole intervention.
    expect(worstSpecialist).toBeLessThan(coordinator / 4);
  });

  it("a working day of thirty questions must fit in the ceiling", () => {
    const coordinator = costOf(ALL_TOOLS.map((t) => t.name));
    const questions = Math.floor(DAILY_TOKEN_CEILING / coordinator);
    expect(
      questions,
      `a person gets ${questions} questions a day before the ceiling stops them. ` +
        "A working day is about thirty. This is the number that ran out after six " +
        "in Phase 3's first live run.",
    ).toBeGreaterThanOrEqual(30);
  });

  /**
   * ── What Phase 4.5 actually moved ─────────────────────────────────────────
   *
   * The test above measures `ALL_TOOLS`, which is what `toolsFor` still
   * returns and what the coordinator used to receive. This one measures what
   * the coordinator receives **now**, so the two sit side by side and the
   * saving is a number rather than a claim.
   *
   * ⚠ **The specialist half of the bill is not free, and this says so.** A
   * write now costs the coordinator's set *plus* one specialist's — two model
   * calls, not one. The trade only makes sense because the common case is a
   * QUESTION, which pays the first number alone and never the second.
   */
  it("reports the before and the after, and the after must be a fraction", () => {
    const before = costOf(ALL_TOOLS.map((t) => t.name));
    const after = costOf(coordinatorToolNames());

    // A write: the coordinator routes, then one specialist acts.
    const perDomainAct = DOMAINS.map((d) => ({
      id: d.id,
      cost: costOf(toolsForDomain(d.id, "act").map((t) => t.name)),
    }));
    const worstAct = Math.max(...perDomainAct.map((p) => p.cost));

    console.log(
      JSON.stringify(
        {
          PHASE_4_5: "coordinator tool definitions, per call",
          beforeTokens: before,
          afterTokens: after,
          reduction: `${(before / after).toFixed(1)}x`,
          questionsPerDayBefore: Math.floor(DAILY_TOKEN_CEILING / before),
          questionsPerDayAfter: Math.floor(DAILY_TOKEN_CEILING / after),
          // The honest cost of a write, both calls added together.
          writePathBeforeTokens: before,
          writePathAfterTokens: after + worstAct,
          worstActModeSpecialist: worstAct,
          perDomainAct,
        },
        null,
        1,
      ),
    );

    // The headroom Phase 3 called "seventeen-fold and not in doubt". Pinned at
    // four so this fails loudly if the coordinator starts collecting tools
    // again, rather than only when it has collected all of them.
    expect(
      after,
      `the coordinator costs ${after} tokens per call against ${before} before. ` +
        "If this is creeping back up, something is being added to the hot set.",
    ).toBeLessThan(before / 4);

    // ⚠ And the write path — TWO calls now — must still beat the old ONE call.
    // If it did not, the restructuring would be paying for cheaper questions
    // with dearer writes, and that is a trade nobody agreed to.
    expect(
      after + worstAct,
      "a write costs the coordinator plus one specialist. That total must still " +
        "be less than what one call used to cost, or this phase made writes dearer.",
    ).toBeLessThan(before);
  });
});

/** The write half of the catalogue, by name. */
function isWrite(name: string): boolean {
  return /^(approve|decline|create|update|delete|cancel|assign|book|start|complete|set|store|require|report|capture|log|minute|add|remove|edit|register|close|claim|clock|deactivate|reactivate|apply|request|notify|send|undo|select|commit|mark|drop|carry)_/.test(
    name,
  );
}
