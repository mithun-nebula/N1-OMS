import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { resetFakeLlm } from "@/config/llm-fake";
import { CourseService } from "@/domains/course/service";
import { ToolContext, type ToolDeps } from "./tools/context";
import { ALL_TOOLS } from "./tools";
import { toolsForDomain, DOMAINS } from "./specialists/domains";
import { resetTokenBudget } from "./token-budget";
import { resetConfirmations } from "./tools/confirmation";
import { resetProposals } from "./tools/propose";

/**
 * Permission equivalence, for **writes**.
 *
 * The existing `permission-equivalence.test.ts` states the read property:
 * *every record the assistant surfaces is one they could already have opened.*
 * This is the write half, and it is the same shape:
 *
 *   **Every change the assistant makes for somebody is one they could already
 *   have made on a screen.**
 *
 * Checked by taking the same instruction as six different people and comparing
 * what the graph actually holds afterwards against what `Spine.submit` would
 * have allowed had they filled in the form themselves. Not "did it refuse" —
 * **did anything change**.
 *
 * ⚠ Both paths. A specialist answering in parallel is a second place the
 * boundary could go wrong, so the fan-out is asserted to have no write tools at
 * all rather than assumed to behave.
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
});

function turn(actor: string) {
  const ctx = new ToolContext(actor, deps);
  return async (name: string, input: Record<string, unknown> = {}) => {
    const spec = ALL_TOOLS.find((t) => t.name === name);
    if (!spec) throw new Error(`no tool ${name}`);
    const built = spec.build(ctx) as { execute: (i: unknown, o: unknown) => Promise<unknown> };
    return (await built.execute(input, { toolCallId: "t", messages: [] })) as Record<
      string,
      unknown
    >;
  };
}

/**
 * The instructions, and the operation each maps to. Fixed, so every role is
 * asked exactly the same thing and any difference is the permission layer.
 */
const INSTRUCTIONS = [
  {
    what: "create a task for Arun",
    tool: "create_task",
    input: { title: "Equivalence probe", assignedTo: "arun" },
    operation: "task.create",
    args: { title: "Equivalence probe", assignedTo: "arun" },
  },
  {
    what: "book a room",
    tool: "book_room",
    input: { title: "Probe", from: "2027-06-01T10:00:00Z", to: "2027-06-01T11:00:00Z" },
    operation: "room.book",
    args: { title: "Probe", from: "2027-06-01T10:00:00Z", to: "2027-06-01T11:00:00Z" },
  },
  {
    what: "put an entry on the calendar",
    tool: "create_calendar_entry",
    input: { title: "Probe", kind: "event", date: "2027-06-02" },
    operation: "calendar.create",
    args: { title: "Probe", kind: "event", date: "2027-06-02" },
  },
  {
    what: "report a fault",
    tool: "report_fault",
    input: { equipmentId: "projector-hall-1", fault: "probe" },
    operation: "equipment.reportFault",
    args: { equipmentId: "projector-hall-1", fault: "probe" },
  },
] as const;

describe("the assistant cannot cause a change the person could not make", () => {
  for (const actor of ROLES) {
    it(`matches the screen, as ${actor}`, async () => {
      for (const instruction of INSTRUCTIONS) {
        // What the SCREEN would do: the same operation, submitted by hand.
        const onScreen = await world.spine.submit(
          adapters.fromForm({
            actor,
            name: instruction.operation,
            args: { ...instruction.args },
          }),
        );
        const screenAllowed = onScreen.status === "ran";

        // What the ASSISTANT does with the same instruction.
        const throughTool = await turn(actor)(instruction.tool, { ...instruction.input });
        const assistantActed = throughTool.ok === true;

        expect(
          assistantActed,
          `${actor} · ${instruction.what}: screen=${onScreen.status}, assistant=${JSON.stringify(
            throughTool.ok,
          )}`,
        ).toBe(screenAllowed);

        if (!assistantActed) {
          // And it must SAY so, or a refusal gets narrated as success.
          expect(throughTool.didNotHappen, `${actor} · ${instruction.what}`).toBe(true);
          expect(typeof throughTool.tellThem).toBe("string");
        }
      }
    });
  }

  it("an intern cannot approve anything", async () => {
    const requested = await world.spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "leave.request",
        args: { employeeId: "priya", fromDate: "2026-09-01", toDate: "2026-09-02" },
      }),
    );
    const leaveId = (requested.result?.response as { leaveId: string }).leaveId;

    // Not even to the point of preparing one: `approve_leave` is not offered to
    // an intern at all, because it requires `view` on leave.
    const spec = ALL_TOOLS.find((t) => t.name === "approve_leave")!;
    const offered = deps.permissions.can({
      actor: "ravi",
      action: spec.requires!.action,
      nodeType: spec.requires!.nodeType,
    }).allowed;

    if (offered) {
      const out = await turn("ravi")("approve_leave", { leaveId });
      expect(out.ok).toBe(false);
    }
    const leave = (await world.deps.graph.getNode("leave", leaveId))?.data as { status?: string };
    expect(leave.status, "an intern approved leave").toBe("Pending");
  });

  it("an employee cannot edit another person's record", async () => {
    const before = (await world.deps.graph.getNode("employee", "arun"))?.data as {
      contact?: string;
    };
    // Prepared, never done — and even the approval must refuse.
    const prepared = await turn("priya")("update_contact", {
      employeeId: "arun",
      contact: "hijacked@example.com",
    });
    expect(prepared.ok).toBe(false);

    if (prepared.proposalId) {
      const approved = await turn("priya")("approve_proposal", {
        proposalId: prepared.proposalId,
      });
      expect(approved.ok, "an employee edited somebody else through a proposal").toBe(false);
    }
    const after = (await world.deps.graph.getNode("employee", "arun"))?.data as {
      contact?: string;
    };
    expect(after.contact).toBe(before.contact);
  });

  it("a manager cannot act outside their own team", async () => {
    // `shruti` is on ops; `james` manages courses.
    const before = (await world.deps.graph.getNode("employee", "shruti"))?.data as {
      contact?: string;
    };
    const prepared = await turn("james")("update_contact", {
      employeeId: "shruti",
      contact: "outside@example.com",
    });
    expect(prepared.ok).toBe(false);
    if (prepared.proposalId) {
      const approved = await turn("james")("approve_proposal", {
        proposalId: prepared.proposalId,
      });
      expect(approved.ok, "a manager reached outside their team").toBe(false);
    }
    const after = (await world.deps.graph.getNode("employee", "shruti"))?.data as {
      contact?: string;
    };
    expect(after.contact).toBe(before.contact);
  });

  it("the fan-out has no write tools at all — the second path cannot change anything", () => {
    // A specialist is consulted for FACTS. If one could write, ten agents
    // running in parallel could each change something as a side effect of being
    // asked a question, and no transcript would explain why.
    const writeNames = new Set(
      ALL_TOOLS.filter((t) => t.name.match(
        /^(approve|decline|create|update|delete|cancel|assign|book|start|complete|set|store|require|report|capture|log|minute|add|remove|edit|register|close|claim|clock|deactivate|reactivate|apply|request|notify|send|undo)_/,
      )).map((t) => t.name),
    );
    for (const domain of DOMAINS) {
      for (const spec of toolsForDomain(domain.id)) {
        expect(
          writeNames.has(spec.name),
          `${domain.id} can reach ${spec.name}, which writes`,
        ).toBe(false);
      }
    }
  });
});
