import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { resetFakeLlm } from "@/config/llm-fake";
import { CourseService } from "@/domains/course/service";
import { ToolContext, type ToolDeps } from "@/domains/assistant/tools";
import { ALL_TOOLS } from "@/domains/assistant/tools/index";
import { resetTokenBudget } from "@/domains/assistant/token-budget";
import { resetConfirmations } from "@/domains/assistant/tools/confirmation";
import {
  resetProposals,
  proposalStore,
  setProposalClock,
  PROPOSAL_TTL_MS,
} from "@/domains/assistant/tools/propose";
import { openProposals, tapApprove, tapDiscard } from "./tap";

/**
 * **A finger issues.**
 *
 * `approve_proposal` is absent from the live tool set, so nothing the model
 * does can complete a money or people operation. This is the other half: the
 * person taps, and it is submitted under their own hand.
 *
 * ── What these tests are actually defending ─────────────────────────────────
 *
 * The tap deliberately bypasses one check — `claimProposal`'s same-turn rule,
 * which has no meaning when there is no turn. **Everything else must still
 * hold**, and a bypass is exactly the kind of change that quietly takes more
 * than it meant to. So: the actor binding, the expiry, single-use, the
 * re-validation at submit time, and the gate.
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

/** The leave record's status, or "(gone)". Narrows the read union in one place. */
async function leaveStatus(actor: string, nodeId = "leave-demo"): Promise<string> {
  const seen = await world.spine.read({ actor, nodeType: "leave", nodeId });
  if (!seen.found) return "(gone)";
  return String((seen.record as { status?: string }).status ?? "(none)");
}

/** Prepare a real proposal the way a routed specialist would. */
async function prepare(actor: string, leaveId = "leave-demo"): Promise<string> {
  const spec = ALL_TOOLS.find((t) => t.name === "approve_leave");
  if (!spec) throw new Error("approve_leave is gone");
  const built = spec.build(new ToolContext(actor, deps)) as {
    execute: (i: unknown, o: unknown) => Promise<unknown>;
  };
  const out = (await built.execute({ leaveId }, { toolCallId: "t", messages: [] })) as {
    proposalId?: string;
    needsApproval?: boolean;
  };
  expect(out.needsApproval, "the propose-gate did not park this").toBe(true);
  return out.proposalId as string;
}

describe("what is waiting to be tapped", () => {
  it("lists this person's open proposals", async () => {
    const id = await prepare("shruti");
    expect((await openProposals("shruti")).map((p) => p.proposalId)).toEqual([id]);
  });

  it("⚠ never lists somebody else's", async () => {
    await prepare("shruti");
    expect(await openProposals("ravi")).toEqual([]);
    expect(await openProposals("james")).toEqual([]);
  });

  it("does not list an expired one", async () => {
    let now = 1_000_000;
    setProposalClock(() => now);
    await prepare("shruti");
    now += PROPOSAL_TTL_MS + 1;
    expect(await openProposals("shruti", now)).toEqual([]);
  });
});

describe("the tap itself", () => {
  it("submits the prepared operation, and it runs", async () => {
    const id = await prepare("shruti");
    const out = await tapApprove({ spine: world.spine, actor: "shruti", proposalId: id });
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true });
    if (out.ok) expect(out.did).toBe("leave.approve");
  });

  it("submits what was PREPARED, not what is re-derived", async () => {
    // The proposal stored the whole {opName, args} when it was made. Nothing
    // about tapping rebuilds them, so nothing can rebuild them differently.
    const id = await prepare("shruti");
    const stored = await proposalStore().get(id);
    expect(stored?.opName).toBe("leave.approve");
    expect(stored?.args).toMatchObject({ leaveId: "leave-demo" });
    await tapApprove({ spine: world.spine, actor: "shruti", proposalId: id });
    expect(await leaveStatus("shruti")).toMatch(/approved/i);
  });

  it("is single-use — the same tap twice does nothing the second time", async () => {
    const id = await prepare("shruti");
    expect((await tapApprove({ spine: world.spine, actor: "shruti", proposalId: id })).ok).toBe(true);
    const again = await tapApprove({ spine: world.spine, actor: "shruti", proposalId: id });
    expect(again.ok).toBe(false);
  });
});

describe("⚠ what the bypass must NOT have taken with it", () => {
  it("one person cannot tap another person's proposal", async () => {
    const id = await prepare("shruti");
    for (const other of ["ravi", "james", "priya", "admin", "superadmin"]) {
      const out = await tapApprove({ spine: world.spine, actor: other, proposalId: id });
      expect(out.ok, `${other} approved shruti's proposal`).toBe(false);
    }
    // And it is still there for the person it belongs to.
    expect((await openProposals("shruti")).map((p) => p.proposalId)).toEqual([id]);
  });

  it("the refusal does not reveal whether the id exists", async () => {
    const id = await prepare("shruti");
    const somebodyElses = await tapApprove({ spine: world.spine, actor: "ravi", proposalId: id });
    const madeUp = await tapApprove({
      spine: world.spine,
      actor: "ravi",
      proposalId: "prop_00000000-0000-0000-0000-000000000000",
    });
    expect(somebodyElses.ok).toBe(false);
    expect(madeUp.ok).toBe(false);
    if (!somebodyElses.ok && !madeUp.ok) {
      expect(somebodyElses.reason).toBe(madeUp.reason);
      expect(somebodyElses.status).toBe(madeUp.status);
    }
  });

  it("an expired proposal is refused, and nothing runs", async () => {
    let now = 1_000_000;
    setProposalClock(() => now);
    const id = await prepare("shruti");
    now += PROPOSAL_TTL_MS + 1;
    const out = await tapApprove({ spine: world.spine, actor: "shruti", proposalId: id });
    expect(out.ok).toBe(false);
    expect(await leaveStatus("shruti")).toMatch(/pending/i);
  });

  /**
   * ⚠ **An intern CAN prepare a proposal, and that surprised this test.**
   *
   * The propose-gate runs before the permission check: `wouldPark` decides on
   * the OPERATION, not on the person, so anybody who can reach the tool gets a
   * proposal back. Authority is decided where it is always decided — at
   * `Spine.submit`.
   *
   * That is the right order, and worth pinning: it means the tap cannot be a
   * way round the gate even when a proposal exists, because the proposal was
   * never a permission in the first place. It also means "there is something
   * waiting on your screen" is not evidence that you may do it.
   */
  it("⚠ the gate still decides — an intern's own proposal is refused when tapped", async () => {
    const spec = ALL_TOOLS.find((t) => t.name === "approve_leave")!;
    const built = spec.build(new ToolContext("ravi", deps)) as {
      execute: (i: unknown, o: unknown) => Promise<unknown>;
    };
    const prepared = (await built.execute(
      { leaveId: "leave-demo" },
      { toolCallId: "t", messages: [] },
    )) as { ok?: boolean; proposalId?: string; needsApproval?: boolean };

    // Nothing ran, and a proposal exists — for the intern, on the intern's own
    // screen. This is the interesting part.
    expect(prepared.ok).not.toBe(true);

    if (prepared.needsApproval === true && prepared.proposalId) {
      const out = await tapApprove({
        spine: world.spine,
        actor: "ravi",
        proposalId: prepared.proposalId,
      });
      expect(out.ok, "an intern approved leave by tapping").toBe(false);
      if (!out.ok) expect(out.status).toBe(403);
    }

    // And the leave is untouched either way.
    expect(await leaveStatus("admin")).toMatch(/pending/i);
  });

  it("drift is caught — the facts are re-read at submit, never trusted from the snapshot", async () => {
    const id = await prepare("shruti");
    // The record goes away between preparing and tapping. `Spine.submit` runs
    // validate() against the world as it is NOW, so this must refuse rather
    // than act on the stored arguments.
    await world.deps.graph.removeNode("leave", "leave-demo");
    const out = await tapApprove({ spine: world.spine, actor: "shruti", proposalId: id });
    expect(out.ok, "a stale proposal ran against a record that no longer exists").toBe(false);
  });
});

describe("throwing one away", () => {
  it("discards it, and nothing runs", async () => {
    const id = await prepare("shruti");
    expect(await tapDiscard("shruti", id)).toBe(true);
    expect(await openProposals("shruti")).toEqual([]);
    expect(await leaveStatus("shruti")).toMatch(/pending/i);
  });

  it("cannot discard somebody else's", async () => {
    const id = await prepare("shruti");
    expect(await tapDiscard("ravi", id)).toBe(false);
    expect(await openProposals("shruti")).toHaveLength(1);
  });
});
