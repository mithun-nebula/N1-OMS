import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { resetFakeLlm } from "@/config/llm-fake";
import { CourseService } from "@/domains/course/service";
import { ToolContext, type ToolDeps } from "../context";
import { ALL_TOOLS } from "../index";
import { resetTokenBudget } from "../../token-budget";
import { resetConfirmations } from "../confirmation";
import { resetProposals, setProposalClock } from "../propose";

/**
 * Turn 2 — the three ways it goes wrong, each with the mechanism that stops it.
 *
 * Re-derivation, drift and ambiguity are all silent failures: nothing throws,
 * and the person believes they approved what they were shown. So each one is
 * tested against the thing that actually prevents it, not against care.
 */

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

/** One turn. Reusing a context is what makes two calls share a turn. */
function turn(actor: string) {
  const ctx = new ToolContext(actor, deps);
  return async (name: string, input: Record<string, unknown> = {}) => {
    const spec = ALL_TOOLS.find((t) => t.name === name)!;
    const built = spec.build(ctx) as { execute: (i: unknown, o: unknown) => Promise<unknown> };
    return (await built.execute(input, { toolCallId: "t", messages: [] })) as Record<
      string,
      unknown
    >;
  };
}

/** A leave request that really exists, so approving it can really succeed. */
async function aLeaveRequest(): Promise<string> {
  const submitted = await world.spine.submit(
    adapters.fromForm({
      actor: "priya",
      name: "leave.request",
      args: { employeeId: "priya", fromDate: "2026-09-01", toDate: "2026-09-02" },
    }),
  );
  const response = submitted.result?.response as { leaveId?: string } | undefined;
  return response?.leaveId as string;
}

describe("turn 2 — approving what was prepared", () => {
  it("submits the stored operation, and the prepared thing actually happens", async () => {
    const leaveId = await aLeaveRequest();

    const one = turn("shruti");
    const prepared = await one("approve_leave", { leaveId });
    expect(prepared.ok).toBe(false);
    expect(prepared.needsApproval).toBe(true);

    // A NEW turn — the person has replied.
    const two = turn("shruti");
    const done = await two("approve_proposal", { proposalId: prepared.proposalId });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    expect(done.did).toBe("leave.approve");

    const leave = (await world.deps.graph.getNode("leave", leaveId))?.data as { status?: string };
    expect(leave.status).toBe("Approved");
  });

  it("cannot be approved in the turn that prepared it", async () => {
    const leaveId = await aLeaveRequest();
    const one = turn("shruti");
    const prepared = await one("approve_leave", { leaveId });
    // The model chaining two calls in one loop, having asked nobody.
    const sneaked = await one("approve_proposal", { proposalId: prepared.proposalId });

    expect(sneaked.ok).toBe(false);
    expect(sneaked.didNotHappen).toBe(true);
    expect(String(sneaked.reason)).toMatch(/not asked them yet|same turn/i);
    const leave = (await world.deps.graph.getNode("leave", leaveId))?.data as { status?: string };
    expect(leave.status).not.toBe("Approved");
  });

  it("expires — a proposal approved tomorrow is a change against stale facts", async () => {
    let clock = 1_000_000;
    setProposalClock(() => clock);
    const leaveId = await aLeaveRequest();
    const prepared = await turn("shruti")("approve_leave", { leaveId });

    clock += 60 * 60 * 1000; // an hour, well past the few minutes allowed
    const out = await turn("shruti")("approve_proposal", { proposalId: prepared.proposalId });

    expect(out.ok).toBe(false);
    expect(String(out.reason)).toMatch(/expired/i);
    const leave = (await world.deps.graph.getNode("leave", leaveId))?.data as { status?: string };
    expect(leave.status).not.toBe("Approved");
  });

  it("re-validates at submit time, so drift between the turns is caught", async () => {
    const leaveId = await aLeaveRequest();
    const prepared = await turn("shruti")("approve_leave", { leaveId });

    // The record changes underneath: the request is withdrawn between turns.
    // The proposal's snapshot still says it is fine; the snapshot is not
    // trusted, and `validate()` runs again on the record as it is NOW.
    const before = (await world.deps.graph.getNode("leave", leaveId))!.data as Record<
      string,
      unknown
    >;
    await world.deps.graph.putNode("leave", leaveId, { ...before, status: "Withdrawn" });

    const out = await turn("shruti")("approve_proposal", { proposalId: prepared.proposalId });
    expect(out.ok).toBe(false);
    expect(out.didNotHappen).toBe(true);
    expect(String(out.tellThem)).toMatch(/changed since you prepared it/i);
  });

  it("two open proposals produce a QUESTION, never a guess", async () => {
    const first = await aLeaveRequest();
    const second = await world.spine.submit(
      adapters.fromForm({
        actor: "arun",
        name: "leave.request",
        args: { employeeId: "arun", fromDate: "2026-09-05", toDate: "2026-09-06" },
      }),
    );
    const secondId = (second.result?.response as { leaveId: string }).leaveId;

    const one = turn("shruti");
    await one("approve_leave", { leaveId: first });
    await one("approve_leave", { leaveId: secondId });

    // An ambiguous "yes", with no id.
    const out = await turn("shruti")("approve_proposal", {});
    expect(out.ok).toBe(false);
    expect(String(out.reason)).toMatch(/more than one/i);
    expect(String(out.tellThem)).toMatch(/do NOT guess/i);
    expect((out.waiting as unknown[]).length).toBe(2);

    // And neither was approved.
    for (const id of [first, secondId]) {
      const leave = (await world.deps.graph.getNode("leave", id))?.data as { status?: string };
      expect(leave.status).not.toBe("Approved");
    }
  });

  it("one open proposal is unambiguous, so a bare yes works", async () => {
    const leaveId = await aLeaveRequest();
    await turn("shruti")("approve_leave", { leaveId });
    const out = await turn("shruti")("approve_proposal", {});
    expect(out.ok, JSON.stringify(out)).toBe(true);
  });

  it("a proposal cannot be spent twice", async () => {
    const leaveId = await aLeaveRequest();
    const prepared = await turn("shruti")("approve_leave", { leaveId });
    expect((await turn("shruti")("approve_proposal", { proposalId: prepared.proposalId })).ok).toBe(
      true,
    );
    const again = await turn("shruti")("approve_proposal", { proposalId: prepared.proposalId });
    expect(again.ok).toBe(false);
    expect(again.didNotHappen).toBe(true);
  });

  it("one person's proposal is invisible to another", async () => {
    const leaveId = await aLeaveRequest();
    const prepared = await turn("shruti")("approve_leave", { leaveId });
    // `james` was never shown this and must not be able to spend it.
    const out = await turn("james")("approve_proposal", { proposalId: prepared.proposalId });
    expect(out.ok).toBe(false);
    expect(String(out.reason)).toMatch(/no proposal with that id/i);
  });

  it("a made-up proposal id is refused", async () => {
    const out = await turn("shruti")("approve_proposal", { proposalId: "prop_invented" });
    expect(out.ok).toBe(false);
    expect(out.didNotHappen).toBe(true);
  });
});
