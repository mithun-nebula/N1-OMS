import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { setFakeLlmScript, resetFakeLlm } from "@/config/llm-fake";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { CourseService } from "@/domains/course/service";
import { DayPlanService } from "@/domains/assistant/day-plan/service";
import { DayPlanStore } from "@/domains/assistant/day-plan/store";
import { openDay } from "@/domains/assistant/day-plan/test-support";
import { ask } from "../agent";
import { ToolContext, type ToolDeps } from "../tools";
import { writeTools } from "../tools/write";
import { dayWriteTools } from "../tools/day-write";
import { commitmentTools } from "../tools/commitment-write";
import { resetTokenBudget } from "../token-budget";
import {
  DOMAINS,
  UNROUTED_WRITE_NAMES,
  specialistTools,
  toolsForDomain,
  type DomainId,
} from "./domains";

/**
 * **Ask mode has no write tool. Not refused — ABSENT.**
 *
 * ── Why this file is the one that decides whether Phase 4.5 is safe ─────────
 *
 * The rule it protects is older than the phase and has held since Phase 2:
 *
 * > *"A specialist is consulted for facts; the coordinator is what acts. A
 * > fan-out can never change anybody's day as a side effect of being asked a
 * > question."*
 *
 * Phase 4.5 moved every write into a specialist, which looks, from a distance,
 * exactly like breaking that rule. It does not, because a specialist now has
 * **two** tool sets and the fan-out can only ever build one of them.
 *
 * The distinction that carries the whole argument is *absent* versus *refuses*.
 * A refusal is a decision taken at call time by something that could have
 * decided otherwise — a prompt, a flag, a branch somebody can edit. Absence is
 * not a decision at all: there is no tool, so there is no call, so there is
 * nothing to get wrong. Every other guarantee in this codebase is built that
 * way (the actor is a closure and not a parameter; `record.*` is never a tool),
 * and this is the same shape.
 *
 * ⚠ **The derived write list.** These tests do not hold a hand-written list of
 * what writes. They read `writeTools`, `dayWriteTools` and `commitmentTools` —
 * the same arrays `ALL_TOOLS` is built from. A hand-written list is correct
 * until somebody adds the fifty-seventh operation; a derived one fails the day
 * that operation has no home, which is the day it matters.
 */

const EVERY_WRITE_NAME: readonly string[] = [
  ...writeTools.map((t) => t.name),
  ...dayWriteTools.map((t) => t.name),
  ...commitmentTools.map((t) => t.name),
];

const TODAY = "2026-08-08";

let world: DemoWorld;
let deps: ToolDeps;
let dayPlan: DayPlanService;
let dayStore: DayPlanStore;

beforeEach(async () => {
  process.env.ORG_LLM_PROVIDER = "fake";
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetTokenBudget();
  world = await buildDemoWorld();
  dayStore = new DayPlanStore();
  dayPlan = new DayPlanService(dayStore, {
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

describe("ask mode cannot write, for every domain", () => {
  it("no domain's ask set contains any write tool", () => {
    for (const d of DOMAINS) {
      const names = toolsForDomain(d.id, "ask").map((t) => t.name);
      for (const w of EVERY_WRITE_NAME) {
        expect(
          names,
          `${d.id} can reach ${w} while ANSWERING A QUESTION — a fan-out could change somebody's day`,
        ).not.toContain(w);
      }
    }
  });

  it("the default is ask, so a caller that forgets still cannot write", () => {
    // The signature defaults to "ask" on purpose. This asserts the default
    // rather than trusting the word `= "ask"` to stay where it is.
    for (const d of DOMAINS) {
      const defaulted = toolsForDomain(d.id).map((t) => t.name);
      const explicit = toolsForDomain(d.id, "ask").map((t) => t.name);
      expect(defaulted).toEqual(explicit);
    }
  });

  it("ask mode is exactly the domain's reads plus the shared figure tool", () => {
    for (const d of DOMAINS) {
      const names = toolsForDomain(d.id, "ask").map((t) => t.name).sort();
      expect(names).toEqual([...d.toolNames, "explain_figure"].sort());
    }
  });
});

describe("act mode holds this domain's writes, and only this domain's", () => {
  it("every write a domain declares is actually in its act set", () => {
    for (const d of DOMAINS) {
      const names = toolsForDomain(d.id, "act").map((t) => t.name);
      for (const w of d.writeToolNames) {
        expect(names, `${d.id} declares ${w} but cannot reach it`).toContain(w);
      }
    }
  });

  it("a domain in act mode reaches no OTHER domain's writes", () => {
    // The blast radius of a mis-routed instruction. Sent to the wrong
    // specialist, the worst case must be "it cannot do that", never "it did
    // something else".
    for (const d of DOMAINS) {
      const mine = new Set<string>(d.writeToolNames);
      const names = toolsForDomain(d.id, "act").map((t) => t.name);
      const foreign = EVERY_WRITE_NAME.filter((w) => !mine.has(w) && names.includes(w));
      expect(foreign, `${d.id} can reach writes that are not its own`).toEqual([]);
    }
  });

  it("every write has exactly one home, and the ones that have none are named", () => {
    // ⚠ Derived, not asserted against a copy of the list. The day somebody adds
    // an operation without giving it a domain, this fails and names it.
    const homed = new Map<string, DomainId[]>();
    for (const d of DOMAINS) {
      for (const w of d.writeToolNames) homed.set(w, [...(homed.get(w) ?? []), d.id]);
    }

    const twice = [...homed.entries()].filter(([, ds]) => ds.length > 1);
    expect(twice, "a write in two specialists can be reached two ways").toEqual([]);

    const invented = [...homed.keys()].filter((w) => !EVERY_WRITE_NAME.includes(w));
    expect(invented, "a domain names a write tool that does not exist").toEqual([]);

    // The five that stay on the coordinator, each for a reason written down in
    // `domains.ts`: two cannot be routed because the turn that spends them
    // carries no domain, two are messaging (telling somebody something is not
    // an area), and `undo_last` is cross-domain by nature.
    const orphans = EVERY_WRITE_NAME.filter((w) => !homed.has(w)).sort();
    expect(orphans).toEqual(
      ["approve_proposal", "discard_proposal", "notify_people", "send_message", "undo_last"].sort(),
    );
    // And the same list, derived the other way round from the table itself.
    expect([...UNROUTED_WRITE_NAMES].sort()).toEqual(orphans);
  });
});

describe("the fan-out is ask-mode only", () => {
  /**
   * The assertion that stops a later edit widening this quietly.
   *
   * `consultSpecialists` passes the literal string `"ask"`. There is no
   * parameter, no default and nothing derived from the model's input that could
   * make it `"act"` — so a change that widened it would have to be a visible
   * edit to that line, and this test is what makes the edit fail.
   */
  it("a specialist consulted during a fan-out is built with no write tool", () => {
    const ctx = new ToolContext("superadmin", deps);
    for (const d of DOMAINS) {
      const { names } = specialistTools(ctx, d.id, "ask");
      for (const w of EVERY_WRITE_NAME) {
        expect(names, `${d.id} could ${w} inside a fan-out`).not.toContain(w);
      }
    }
  });

  it("a question that fans out changes nothing, asserted from the day plan", async () => {
    // Not from the answer text — an answer can say anything. The day plan is
    // ground truth, and `day` is the specialist whose writes are easiest to
    // reach by accident, because `my_day` is the very tool a fan-out would call.
    //
    // The day is OPENED first, deliberately. Against a day that does not exist,
    // `select_item` would have been refused by the service anyway and this test
    // would pass without proving anything about the tool set.
    await openDay(dayPlan, "james", TODAY);
    const before = dayStore.get("james", TODAY)!.plan.length;

    setFakeLlmScript([
      {
        toolCalls: [
          {
            toolName: "consult_specialists",
            input: { domains: ["day"], question: "what is on james today?" },
          },
        ],
      },
      // The specialist tries to write anyway. There is no such tool in its
      // record, so this is a call into thin air.
      { toolCalls: [{ toolName: "select_item", input: { label: "smuggled", estimateMinutes: 30 } }] },
      { text: "Nothing is committed." },
      { text: "Nothing is on today." },
    ]);
    await ask({ actor: "james", question: "What is on me today?", deps });

    const after = dayStore.get("james", TODAY)!.plan;
    expect(after.length, "a question added something to somebody's day").toBe(before);
    expect(after.map((i) => i.label)).not.toContain("smuggled");
  });

  it("acting is one named specialist — the schema cannot express a list", async () => {
    // `consult_specialists` takes `domains: [...]`. `delegate_action` takes
    // `domain: one`. That difference is the guarantee that several agents
    // cannot act in parallel off one sentence, and it is enforced by a schema
    // rather than by a rule somebody has to remember.
    const { delegateAction } = await import("../fanout");
    const built = delegateAction({
      ctx: new ToolContext("james", deps),
      model: (await import("@/config/providers")).providers().llm.languageModel(),
    }) as { inputSchema?: { shape?: Record<string, unknown> } };
    const shape = built.inputSchema?.shape ?? {};
    expect(Object.keys(shape)).toContain("domain");
    expect(Object.keys(shape)).not.toContain("domains");
  });
});
