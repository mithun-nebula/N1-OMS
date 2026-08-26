import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { resetFakeLlm } from "@/config/llm-fake";
import { CourseService } from "@/domains/course/service";
import { ToolContext, type ToolDeps } from "../context";
import { ALL_TOOLS } from "../index";
import { WRITE_SPECS } from "./index";
import { resetTokenBudget } from "../../token-budget";
import { resetConfirmations } from "../confirmation";
import { resetProposals, wouldPark, setProposalClock, proposalStore } from "../propose";

/**
 * **The agent never submits a money or people operation.**
 *
 * This is the test the phase is safe or unsafe on. Everything else can be
 * rebuilt; if this is wrong, the assistant is a way round the gate.
 *
 * ── What it actually watches ────────────────────────────────────────────────
 *
 * Not "did the tool return a proposal" — a tool could return one *and* have
 * written to the graph on the way. It records every `putNode` and `removeNode`
 * for the duration of the call, the same trick `conformance.test.ts` uses, and
 * asserts **nothing was written at all**.
 *
 * Across all six roles, because a hole that opens only for `admin` is still a
 * hole, and `superadmin` is the role most likely to have been waved through.
 */

const ROLES = ["superadmin", "admin", "shruti", "james", "priya", "ravi"] as const;

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
  setProposalClock(undefined);
});

/** Record every write the graph takes while `fn` runs. */
async function writesDuring(fn: () => Promise<unknown>): Promise<string[]> {
  const graph = world.deps.graph as unknown as {
    putNode: (...a: unknown[]) => unknown;
    removeNode: (...a: unknown[]) => unknown;
  };
  const put = graph.putNode.bind(graph);
  const remove = graph.removeNode.bind(graph);
  const seen: string[] = [];
  graph.putNode = (...a: unknown[]) => {
    seen.push(`put ${String(a[0])}:${String(a[1])}`);
    return put(...a);
  };
  graph.removeNode = (...a: unknown[]) => {
    seen.push(`remove ${String(a[0])}:${String(a[1])}`);
    return remove(...a);
  };
  try {
    await fn();
  } finally {
    graph.putNode = put;
    graph.removeNode = remove;
  }
  return seen;
}

async function callTool(actor: string, name: string, input: Record<string, unknown>) {
  const spec = ALL_TOOLS.find((t) => t.name === name);
  if (!spec) throw new Error(`no tool ${name}`);
  const built = spec.build(new ToolContext(actor, deps)) as {
    execute: (i: unknown, o: unknown) => Promise<unknown>;
  };
  return (await built.execute(input, { toolCallId: "t", messages: [] })) as Record<
    string,
    unknown
  >;
}

/** Plausible arguments for every propose-gated tool. */
const PROPOSE_CALLS: Array<[string, Record<string, unknown>]> = [
  ["approve_leave", { leaveId: "lv_1" }],
  ["decline_leave", { leaveId: "lv_1", reason: "no cover" }],
  ["request_leave", { employeeId: "priya", fromDate: "2026-09-01", toDate: "2026-09-02" }],
  ["approve_expense", { claimId: "exp_1" }],
  ["decline_expense", { claimId: "exp_1", reason: "no receipt" }],
  [
    "claim_expense",
    { employeeId: "priya", amount: 10, category: "travel", description: "taxi", date: "2026-08-01" },
  ],
  [
    "create_employee",
    {
      employeeId: "newbie",
      name: "New Person",
      role: "employee",
      username: "newbie",
      temporaryPassword: "temp1234",
    },
  ],
  ["deactivate_employee", { employeeId: "priya", lastWorkingDay: "2026-09-30", reason: "left" }],
  ["reactivate_employee", { employeeId: "priya", temporaryPassword: "temp1234" }],
  ["set_pay", { employeeId: "priya", pay: 60000, effectiveFrom: "2026-09-01" }],
  ["update_employee", { employeeId: "priya", patch: { team: "ops" } }],
  ["update_contact", { employeeId: "priya", contact: "new@example.com" }],
  ["start_joining", { employeeId: "priya" }],
  ["complete_joining_step", { employeeId: "priya", stepId: "s1" }],
  ["start_leaving", { employeeId: "priya", separationDate: "2026-09-30" }],
  ["complete_handover", { employeeId: "priya", handoverId: "h1" }],
  ["apply_separation", { employeeId: "priya" }],
  ["clock_in", { employeeId: "priya", date: "2026-08-08" }],
  ["clock_out", { employeeId: "priya", date: "2026-08-08" }],
  ["assign_course", { courseId: "c1", assignees: ["priya"] }],
];

describe("the agent never submits a money or people operation", () => {
  it("covers every propose-gated tool — the list cannot silently shrink", () => {
    const gated = WRITE_SPECS.filter((w) => w.tier === "propose").map((w) => w.tool).sort();
    expect(PROPOSE_CALLS.map(([n]) => n).sort()).toEqual(gated);
    // 15 by the money flag, plus the 5 the plan overlooked that park by
    // category. See `spine/operation/declarations.test.ts`.
    expect(gated).toHaveLength(20);
  });

  for (const actor of ROLES) {
    it(`writes nothing, for any of them, as ${actor}`, async () => {
      for (const [name, input] of PROPOSE_CALLS) {
        const spec = ALL_TOOLS.find((t) => t.name === name)!;
        // A tool the role cannot even see is already refused, before this.
        const decision = spec.requires
          ? deps.permissions.can({
              actor,
              action: spec.requires.action,
              nodeType: spec.requires.nodeType,
            })
          : { allowed: true };
        if (!decision.allowed) continue;

        let out: Record<string, unknown> = {};
        const writes = await writesDuring(async () => {
          out = await callTool(actor, name, input);
        });

        expect(writes, `${actor} · ${name} wrote to the graph`).toEqual([]);
        expect(out.ok, `${actor} · ${name} reported success`).toBe(false);
        expect(out.needsApproval, `${actor} · ${name} did not propose`).toBe(true);
        expect(out.didNotHappen, `${actor} · ${name} refusal was quiet`).toBe(true);
        expect(String(out.tellThem)).toMatch(/nothing has happened|confirm/i);
      }
    });
  }

  it("proposes even when the tier says otherwise — the handler decides", async () => {
    // The tier is written down by hand and could be wrong. `build.ts` asks the
    // HANDLER as well, so a mistyped tier can only ever make a tool stricter.
    for (const spec of WRITE_SPECS) {
      const handler = world.registry.get(spec.operation);
      if (!handler) continue;
      if (wouldPark(handler, {})) {
        expect(spec.tier, `${spec.tool} would park but is declared ${spec.tier}`).toBe("propose");
      }
    }
  });

  it("a proposal carries the whole operation, so turn 2 never re-derives it", async () => {
    const out = await callTool("shruti", "approve_leave", { leaveId: "lv_7" });
    const id = String(out.proposalId);
    const stored = (await proposalStore().get(id))!;
    expect(stored.opName).toBe("leave.approve");
    // The exact args, not a description of them.
    expect(stored.args).toEqual({ leaveId: "lv_7" });
    expect(stored.actor).toBe("shruti");
  });

  it("says NOTHING HAPPENED in the payload, not only in the description", async () => {
    // Phase 2 found `{ ok: false }` narrated as "I've added Module 4". A parked
    // operation described as done is the worst sentence this product can emit.
    const out = await callTool("shruti", "set_pay", {
      employeeId: "priya",
      pay: 1,
      effectiveFrom: "2026-09-01",
    });
    expect(out.didNotHappen).toBe(true);
    expect(String(out.reason)).toMatch(/PREPARED and NOT done/);
    expect(String(out.tellThem)).toMatch(/NOTHING has happened yet/);
    expect(String(out.tellThem)).toMatch(/Do not describe it as done/);
  });
});
