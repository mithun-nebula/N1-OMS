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
import { resetProposals } from "../propose";

/**
 * `undo_last` is a back door, unless it inherits.
 *
 * `Spine.undo` is permission-checked and has been since Phase 0. **But it does
 * not pass through `involvesMoneyOrPeople`**, so without this, an agent could
 * un-approve somebody's leave with no proposal at all — reaching by the back
 * door exactly what the propose-gate exists to prevent.
 *
 * The rule: **undoing a money or people operation is itself a money or people
 * action.** `Spine.undo` is not modified; the gating lives in the tool, as it
 * does for every other write.
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
});

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

describe("undo_last inherits the gating of what it undoes", () => {
  it("PROPOSES against a leave.approve entry — it does not act", async () => {
    const requested = await world.spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "leave.request",
        args: { employeeId: "priya", fromDate: "2026-09-01", toDate: "2026-09-02" },
      }),
    );
    const leaveId = (requested.result?.response as { leaveId: string }).leaveId;
    const approved = await world.spine.submit(
      adapters.fromForm({ actor: "shruti", name: "leave.approve", args: { leaveId } }),
    );
    expect(approved.status).toBe("ran");
    const activityId = approved.activityEntry!.id;

    const out = await turn("shruti")("undo_last", { activityId });

    // ⚠ The whole point. Not undone, and not merely refused — PREPARED.
    expect(out.ok).toBe(false);
    expect(out.needsApproval).toBe(true);
    expect(out.didNotHappen).toBe(true);
    expect(String(out.summary)).toMatch(/leave\.approve/);

    const leave = (await world.deps.graph.getNode("leave", leaveId))?.data as { status?: string };
    expect(leave.status, "the leave was un-approved through the back door").toBe("Approved");
  });

  it("reads back against a routine entry, rather than just doing it", async () => {
    const created = await world.spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "task.create",
        args: { title: "Undo me" },
      }),
    );
    const activityId = created.activityEntry!.id;
    const taskId = (created.result?.response as { taskId: string }).taskId;

    const asked = await turn("james")("undo_last", { activityId });
    expect(asked.ok).toBe(false);
    expect(asked.needsConfirmation).toBe(true);
    expect(await world.deps.graph.getNode("task", taskId)).toBeTruthy();

    // A new turn: the person replied.
    const done = await turn("james")("undo_last", { activityId });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    expect(await world.deps.graph.getNode("task", taskId)).toBeUndefined();
  });

  it("says plainly when there is nothing to reverse, not that it was forbidden", async () => {
    // `notify.send` writes no record and offers no undo. That is not a
    // permission problem, and a refusal that reads like one sends somebody to
    // ask an admin for access that would not help.
    const sent = await world.spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "notify.send",
        args: { message: "hello", to: ["priya"] },
      }),
    );
    const out = await turn("james")("undo_last", { activityId: sent.activityEntry!.id });
    expect(out.ok).toBe(false);
    expect(String(out.reason)).toMatch(/never recorded a way back/i);
    expect(String(out.tellThem)).toMatch(/not that they lack permission/i);
  });

  it("refuses an invented activity id rather than guessing at one", async () => {
    const out = await turn("james")("undo_last", { activityId: "act_invented" });
    expect(out.ok).toBe(false);
    expect(out.didNotHappen).toBe(true);
    expect(String(out.tellThem)).toMatch(/rather than guessing/i);
  });
});
