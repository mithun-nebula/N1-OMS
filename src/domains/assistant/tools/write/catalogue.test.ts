import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { resetFakeLlm } from "@/config/llm-fake";
import { CourseService } from "@/domains/course/service";
import { ToolContext, type ToolDeps } from "../context";
import { ALL_TOOLS } from "../index";
import { WRITE_SPECS, writeTools, NEVER_A_TOOL } from "./index";
import { resetTokenBudget } from "../../token-budget";
import { resetConfirmations } from "../confirmation";
import { resetProposals } from "../propose";

/**
 * Two properties that must hold for **every** write tool, not a sample.
 *
 * The plan names both, and neither had a test that swept the whole catalogue —
 * a gap found by auditing Phase 3 against its own "Done when" list rather than
 * against my memory of it.
 *
 *   1. **No undo, no tool.** An operation nothing can reverse must not be
 *      handed to a model.
 *   2. **Every refusal is loud.** `{ ok: false }` alone was read as success and
 *      narrated as *"I've added Module 4 (60 minutes)"*. Twenty operations
 *      refuse by design here, so a quiet one is not a rare case.
 */

/**
 * Operations with no serialisable undo, from `conformance.test.ts`'s two
 * ratchets. Restated here so a change there fails a test here.
 */
const NO_SERIALISABLE_UNDO = new Set([
  // Offer an undo, but a closure only — it dies on restart.
  "expense.approve",
  "expense.claim",
  "joining.completeStep",
  "leave.approve",
  "leave.decline",
  "leaving.completeHandover",
  // Offer no undo at all.
  "joining.start",
  "leave.request",
  "leaving.applySeparation",
  "leaving.start",
  "notify.send",
]);

let world: DemoWorld;
let deps: ToolDeps;

beforeEach(async () => {
  process.env.ORG_LLM_PROVIDER = "fake";
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetTokenBudget();
  resetConfirmations();
  resetProposals();
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

afterEach(() => {
  delete process.env.ORG_LLM_PROVIDER;
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetConfirmations();
  resetProposals();
});

describe("no undo, no tool", () => {
  /**
   * ⚠ The rule with its one exemption, stated exactly.
   *
   * The plan says flatly *"no undo, no tool"*. Applied literally that would
   * deny a tool to `leave.request`, `joining.start` and four others, and the
   * reason it does not need to is worth stating rather than leaving as a silent
   * exception.
   *
   * What the rule protects against is **the agent doing something irreversible
   * on its own judgement**. Two of the three tiers rule that out already:
   *
   *   `propose`  — the agent never runs it. A person submits it themselves.
   *   `readBack` — the agent runs it only after reading the consequence out and
   *                being told yes, in a later turn it cannot forge.
   *
   * `straight` is the only tier where the agent acts alone. So the rule that
   * actually holds is: **anything the agent can run WITHOUT being told yes must
   * be reversible.**
   *
   * ⚠ A sharper statement of the rule, not a looser one — and it was not
   * written to make the code pass. It **failed** when first written, on
   * `notify_people`, which was `straight` and wraps an operation that cannot be
   * un-sent. The tool was changed to `readBack`. Only then did the rule need
   * stating accurately, because "must propose" is wrong about `readBack` for
   * reasons that have nothing to do with notifications.
   */
  it("nothing irreversible runs without the person being told", () => {
    const violations: string[] = [];
    for (const spec of WRITE_SPECS) {
      if (!NO_SERIALISABLE_UNDO.has(spec.operation)) continue;
      if (spec.tier !== "straight") continue;
      violations.push(
        `${spec.tool} runs ${spec.operation} on its own judgement, and that ` +
          "operation cannot be reversed. It must propose, read back, or not be a tool.",
      );
    }
    expect(
      violations,
      `The agent can do something irreversible without being told yes:\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the exemption is real — tools rely on it, and only the two safe tiers", () => {
    // If this ever drops to zero, the test above is passing vacuously and the
    // exemption should be deleted rather than left standing.
    const relying = WRITE_SPECS.filter((s) => NO_SERIALISABLE_UNDO.has(s.operation));
    expect(relying.length).toBeGreaterThan(0);
    for (const spec of relying) {
      expect(["propose", "readBack"], spec.tool).toContain(spec.tier);
    }
    // And notify_people specifically, because it is the one that was wrong.
    const notify = WRITE_SPECS.find((s) => s.operation === "notify.send")!;
    expect(notify.tier).toBe("readBack");
    expect(String(notify.consequence)).toMatch(/cannot be un-sent/i);
  });

  it("the ratchet lists exactly what conformance.test.ts allows", async () => {
    // Restating a list is only safe if it is checked. Every name here must be a
    // real registered operation, or the set above is protecting nothing.
    const registered = new Set(world.registry.list());
    for (const name of NO_SERIALISABLE_UNDO) {
      expect(registered.has(name), `${name} is not a registered operation`).toBe(true);
    }
  });
});

describe("every refusal is loud, for every write tool", () => {
  it("no write tool can refuse quietly", async () => {
    const quiet: string[] = [];

    for (const spec of ALL_TOOLS) {
      if (!writeTools.some((w) => w.name === spec.name)) continue;
      const ctx = new ToolContext("ravi", deps);
      const built = spec.build(ctx) as {
        execute?: (i: unknown, o: unknown) => Promise<unknown>;
      };
      if (!built.execute) continue;

      let out: Record<string, unknown>;
      try {
        // Called with nothing. Almost everything refuses — on validate, on
        // permission, on the propose-gate or on the read-back — and every one
        // of those paths has to say so in the payload.
        out = (await built.execute({}, { toolCallId: "t", messages: [] })) as Record<
          string,
          unknown
        >;
      } catch {
        // A tool that throws is a different failure and not this test's
        // business, but it must not be silent either.
        quiet.push(`${spec.name} threw instead of returning a refusal`);
        continue;
      }

      if (out?.ok === true) continue;
      if (out?.didNotHappen !== true) {
        quiet.push(`${spec.name} refused without didNotHappen`);
      }
      if (typeof out?.tellThem !== "string" || String(out.tellThem).length < 10) {
        quiet.push(`${spec.name} refused without a usable tellThem`);
      }
    }

    expect(
      quiet,
      "A refusal the model can mistake for success. Phase 2 proved this gets " +
        `narrated as done:\n  ${quiet.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("the catalogue matches the registry", () => {
  it("wraps every operation that should be wrapped, and only those", () => {
    const registered = new Set(world.registry.list());
    const wrapped = new Set(WRITE_SPECS.map((w) => w.operation));

    const unknown = [...wrapped].filter((o) => !registered.has(o));
    expect(unknown, "a write tool names an operation that does not exist").toEqual([]);

    const missing = [...registered].filter(
      (o) => !wrapped.has(o) && !NEVER_A_TOOL.includes(o),
    );
    expect(missing, "an operation has no tool and was not deliberately excluded").toEqual([]);

    expect(wrapped.size).toBe(56);
    for (const never of NEVER_A_TOOL) {
      expect([...wrapped], `${never} must never be a tool`).not.toContain(never);
    }
  });

  it("no two tools share a name, and none wraps the same operation twice", () => {
    const names = writeTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    const ops = WRITE_SPECS.map((w) => w.operation);
    expect(new Set(ops).size).toBe(ops.length);
  });

  it("every description leads with what the tool does NOT do", () => {
    // 1b's rule, and the reason the write catalogue scored as well as it did:
    // naming the sibling is half of it; saying what this tool will not do is
    // the half that stops a model settling for a plausible near-miss.
    for (const spec of WRITE_SPECS) {
      expect(spec.not, `${spec.tool} has no negative clause`).toMatch(/NOT|not\b/);
      expect(spec.not.length, `${spec.tool}'s negative clause is too thin`).toBeGreaterThan(40);
    }
  });
});
