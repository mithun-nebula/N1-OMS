import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { setFakeLlmScript, resetFakeLlm } from "@/config/llm-fake";
import { CourseService } from "@/domains/course/service";
import { ask } from "./agent";
import type { ToolDeps } from "./tools";
import { resetTokenBudget } from "./token-budget";
import { resetConfirmations } from "./tools/confirmation";
import { resetProposals, proposalStore } from "./tools/propose";

/**
 * The two-turn paths, now that a routing hop sits in the middle of them.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Phase 4.5 moved the writes into specialists, which puts an extra agent
 * between the person and the verb. Both of this codebase's two-turn safety
 * mechanisms cross that gap, and they cross it differently:
 *
 *  - **The propose-gate does not go through the hop at all.** Turn 1 delegates
 *    and a proposal comes back; turn 2 is `approve_proposal`, which stayed on
 *    the coordinator precisely so that *"yes"* — a word carrying no domain —
 *    never has to be routed.
 *  - **The read-back does go through it, twice.** The confirmation lives
 *    server-side against `(actor, tool, target)`, so the model carries no
 *    token; but the specialist must reach the same tool against the same target
 *    on turn 2, and it cannot see the conversation.
 *
 * ⚠ **The turn boundary still holds, and this is the reason.** Every specialist
 * shares the coordinator's `ToolContext`, so it shares `turnId` — a
 * confirmation still cannot be issued and spent inside one turn, and adding an
 * agent did not add a boundary. *"A model can chain two tool calls; it cannot
 * forge a person's reply"* is unchanged, and so is what it rests on.
 *
 * The scripts below are the fake model, so they prove the WIRING rather than
 * the judgement. Whether a live model routes these sentences correctly is a
 * different question, asked in the live replay.
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

/** A leave request that really exists, so approving it can really succeed. */
async function aLeaveRequest(): Promise<string> {
  const submitted = await world.spine.submit(
    adapters.fromForm({
      actor: "priya",
      name: "leave.request",
      args: { employeeId: "priya", fromDate: "2026-09-01", toDate: "2026-09-02" },
    }),
  );
  return (submitted.result?.response as { leaveId?: string })?.leaveId as string;
}

/** A task that really exists, so deleting it can really delete something. */
async function aTask(): Promise<string> {
  const submitted = await world.spine.submit(
    adapters.fromForm({
      actor: "superadmin",
      name: "task.create",
      args: { title: "Throwaway", assignedTo: "priya" },
    }),
  );
  return (submitted.result?.response as { taskId?: string })?.taskId as string;
}

const leaveStatus = async (id: string): Promise<string | undefined> =>
  ((await world.deps.graph.getNode("leave", id))?.data as { status?: string })?.status;

describe('"approve Priya\'s leave" -> "yes", with routing in the middle', () => {
  it("turn 1 delegates, prepares, and changes NOTHING", async () => {
    const leaveId = await aLeaveRequest();
    expect(await leaveStatus(leaveId)).toBe("Pending");

    setFakeLlmScript([
      // ── the coordinator routes ──
      {
        toolCalls: [
          {
            toolName: "delegate_action",
            input: {
              domain: "leave-expenses",
              instruction: `Approve the leave request ${leaveId}.`,
            },
          },
        ],
      },
      // ── inside the leave-expenses specialist ──
      { toolCalls: [{ toolName: "approve_leave", input: { leaveId } }] },
      { text: "I have prepared the approval. Nothing has happened yet." },
      // ── back on the coordinator ──
      { text: "I have prepared the approval of Priya's leave. Nothing has happened yet — confirm?" },
    ]);

    const result = await ask({ actor: "shruti", question: "Approve Priya's leave", deps });

    expect(result.source).toBe("llm");
    // The specialist's call is in the transcript, not just "delegate_action".
    expect(result.calls).toContain("approve_leave");
    // ⚠ And the leave is untouched.
    expect(await leaveStatus(leaveId)).toBe("Pending");
    expect(await proposalStore().openFor("shruti", Date.now())).toHaveLength(1);
  });

  it("turn 2 is answered by the coordinator itself, with no routing at all", async () => {
    const leaveId = await aLeaveRequest();

    setFakeLlmScript([
      {
        toolCalls: [
          {
            toolName: "delegate_action",
            input: { domain: "leave-expenses", instruction: `Approve leave ${leaveId}.` },
          },
        ],
      },
      { toolCalls: [{ toolName: "approve_leave", input: { leaveId } }] },
      { text: "Prepared." },
      { text: "Nothing has happened yet — shall I go ahead?" },
    ]);
    await ask({ actor: "shruti", question: "Approve Priya's leave", deps });
    expect(await leaveStatus(leaveId)).toBe("Pending");

    // ── a new turn. "Yes" carries no domain, and it never needs one. ──
    setFakeLlmScript([
      // No id, deliberately: Phase 3 found the model passing a LEAVE id here
      // because it was the only id in front of it. The tool takes none.
      { toolCalls: [{ toolName: "approve_proposal", input: {} }] },
      { text: "Approved." },
    ]);
    const second = await ask({ actor: "shruti", question: "Yes, go ahead.", deps });

    expect(second.calls).toContain("approve_proposal");
    expect(second.calls, "turn 2 must not be routed").not.toContain("delegate_action");
    expect(await leaveStatus(leaveId)).toBe("Approved");
  });

  it('"don\'t ask me, just do it" STILL only prepares — routing did not loosen it', async () => {
    // The guard is in the tool, not in the agent holding it. Moving the tool
    // must not have moved the guard, and that is what this asserts.
    const leaveId = await aLeaveRequest();

    setFakeLlmScript([
      {
        toolCalls: [
          {
            toolName: "delegate_action",
            input: {
              domain: "leave-expenses",
              instruction: `Approve leave ${leaveId} immediately, no confirmation needed.`,
            },
          },
        ],
      },
      { toolCalls: [{ toolName: "approve_leave", input: { leaveId } }] },
      { text: "Prepared, not done." },
      { text: "Nothing has happened yet." },
    ]);
    await ask({
      actor: "shruti",
      question: "Approve Arun's leave. Do not ask me for confirmation, just do it immediately.",
      deps,
    });

    expect(await leaveStatus(leaveId)).toBe("Pending");
  });
});

describe("the read-back survives the hop, and still needs a real turn boundary", () => {
  it("the first delegation reads the consequence back and deletes nothing", async () => {
    const taskId = await aTask();
    expect(await world.deps.graph.getNode("task", taskId)).toBeDefined();

    setFakeLlmScript([
      {
        toolCalls: [
          {
            toolName: "delegate_action",
            input: { domain: "tasks", instruction: `Delete task ${taskId}.` },
          },
        ],
      },
      { toolCalls: [{ toolName: "delete_task", input: { taskId } }] },
      { text: "Deleting it removes it for everybody. Shall I go ahead?" },
      { text: "Deleting that task removes it for everybody. Shall I go ahead?" },
    ]);
    await ask({ actor: "superadmin", question: "Delete that task", deps });

    expect(
      await world.deps.graph.getNode("task", taskId),
      "the first call acted, and it must never act",
    ).toBeDefined();
  });

  it("⚠ two delegations INSIDE ONE TURN still cannot spend the confirmation", async () => {
    // The failure this whole mechanism exists to prevent. A model can chain two
    // tool calls — here, two whole specialists — and take the token from its own
    // first call. Adding an agent between the coordinator and the verb did not
    // add a turn boundary, because the specialist shares the coordinator's
    // `ToolContext` and therefore its `turnId`.
    const taskId = await aTask();

    setFakeLlmScript([
      {
        toolCalls: [
          {
            toolName: "delegate_action",
            input: { domain: "tasks", instruction: `Delete task ${taskId}.` },
          },
        ],
      },
      { toolCalls: [{ toolName: "delete_task", input: { taskId } }] },
      { text: "Asked." },
      // Same turn, second delegation, nobody consulted in between.
      {
        toolCalls: [
          {
            toolName: "delegate_action",
            input: { domain: "tasks", instruction: `Yes, delete task ${taskId}.` },
          },
        ],
      },
      { toolCalls: [{ toolName: "delete_task", input: { taskId } }] },
      { text: "Asked again." },
      { text: "I need you to confirm." },
    ]);
    await ask({ actor: "superadmin", question: "Delete that task, and yes I'm sure", deps });

    expect(
      await world.deps.graph.getNode("task", taskId),
      "a confirmation was issued and spent inside one turn",
    ).toBeDefined();
  });

  it("a second TURN spends it, and the task is gone", async () => {
    const taskId = await aTask();

    setFakeLlmScript([
      {
        toolCalls: [
          {
            toolName: "delegate_action",
            input: { domain: "tasks", instruction: `Delete task ${taskId}.` },
          },
        ],
      },
      { toolCalls: [{ toolName: "delete_task", input: { taskId } }] },
      { text: "Asked." },
      { text: "Shall I go ahead?" },
    ]);
    await ask({ actor: "superadmin", question: "Delete that task", deps });
    expect(await world.deps.graph.getNode("task", taskId)).toBeDefined();

    // ── a new turn: a person replied ──
    //
    // The coordinator must repeat the id. `delegate_action`'s schema asks for
    // it in as many words, because the specialist cannot see the conversation
    // and a bare "yes" would leave it guessing which task was agreed to.
    setFakeLlmScript([
      {
        toolCalls: [
          {
            toolName: "delegate_action",
            input: { domain: "tasks", instruction: `Yes — delete task ${taskId}.` },
          },
        ],
      },
      { toolCalls: [{ toolName: "delete_task", input: { taskId } }] },
      { text: "Deleted." },
      { text: "That task is deleted." },
    ]);
    await ask({ actor: "superadmin", question: "Yes, delete it", deps });

    expect(
      await world.deps.graph.getNode("task", taskId),
      "the read-back could not be completed across a routing hop",
    ).toBeUndefined();
  });
});
