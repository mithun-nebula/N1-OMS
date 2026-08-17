import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { findOverdueSteps } from "./joining";

function world() {
  return buildDemoWorld();
}

describe("joining.start — named step-owners (not a checklist)", () => {
  it("HR creates an onboarding plan with a named owner per step", async () => {
    const { spine, deps } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "joining.start",
        args: { employeeId: "ravi" },
      }),
    );
    expect(res.status).toBe("ran");
    const node = await deps.graph.getNode("onboarding", "onboarding:ravi");
    const steps = (node?.data as { steps?: Array<{ owner?: string }> }).steps;
    expect(steps?.length).toBeGreaterThan(0);
    expect(steps?.[0].owner).toBeTruthy();
  });

  it("a non-HR/non-manager cannot start onboarding (forbidden)", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "arun",
        name: "joining.start",
        args: { employeeId: "ravi" },
      }),
    );
    expect(res.status).toBe("forbidden");
  });
});

describe("joining.completeStep — the named owner can act", () => {
  it("the step's owner completes it (allowedActors grant)", async () => {
    const { spine, deps } = await world();
    await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "joining.start",
        args: { employeeId: "ravi" },
      }),
    );
    const res = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "joining.completeStep",
        args: { employeeId: "ravi", stepId: "policy-ack" },
      }),
    );
    expect(res.status).toBe("ran");
    const node = await deps.graph.getNode("onboarding", "onboarding:ravi");
    const step = ((node?.data.steps as Array<{ id: string; status: string; completedBy?: string }>) ?? []).find(
      (s) => s.id === "policy-ack",
    );
    expect(step?.status).toBe("done");
    expect(step?.completedBy).toBe("ravi");
  });

  it("someone who is not the step's owner is forbidden", async () => {
    const { spine } = await world();
    await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "joining.start",
        args: { employeeId: "ravi" },
      }),
    );
    const res = await spine.submit(
      adapters.fromForm({
        actor: "arun",
        name: "joining.completeStep",
        args: { employeeId: "ravi", stepId: "policy-ack" },
      }),
    );
    expect(res.status).toBe("forbidden");
  });
});

describe("findOverdueSteps — overdue chase", () => {
  it("lists pending steps past their due date", async () => {
    const { spine, deps } = await world();
    await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "joining.start",
        args: {
          employeeId: "naveen",
          steps: [{ title: "Setup", owner: "naveen", dueAt: "2020-01-01" }],
        },
      }),
    );
    const overdue = await findOverdueSteps(deps.graph, "2026-01-01");
    expect(overdue.length).toBe(1);
    expect(overdue[0].employeeId).toBe("naveen");
  });
});

describe("leaving.start — outstanding asset + course handover detection", () => {
  it("detects Meena's 2 laptops + 1 owned course (spec example)", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "leaving.start",
        args: { employeeId: "meena", separationDate: "2026-09-01" },
      }),
    );
    expect(res.status).toBe("ran");
    const response = res.result?.response as {
      outstandingCount: number;
      handovers: Array<{ type: string; to: string }>;
    };
    expect(response.outstandingCount).toBe(3);
    expect(response.handovers.filter((h) => h.type === "course").length).toBe(1);
    expect(response.handovers.filter((h) => h.type === "asset").length).toBe(2);
    expect(response.handovers.every((h) => h.to === "james")).toBe(true);
  });
});

describe("leaving.completeHandover — reassigned to the new owner", () => {
  it("the new owner completes a course handover (reassigns ownership)", async () => {
    const { spine, deps } = await world();
    await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "leaving.start",
        args: { employeeId: "meena", separationDate: "2026-09-01" },
      }),
    );
    const res = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "leaving.completeHandover",
        args: { employeeId: "meena", handoverId: "h-course-ai-basics" },
      }),
    );
    expect(res.status).toBe("ran");
    expect((await deps.graph.getNode("course", "ai-basics"))?.data.owner).toBe("james");
    const offboarding = await deps.graph.getNode("offboarding", "offboarding:meena");
    expect(
      ((offboarding?.data.handovers as Array<{ id: string; status: string }>) ?? []).find(
        (h) => h.id === "h-course-ai-basics",
      )?.status,
    ).toBe("done");
  });

  it("someone who is not the new owner/HR is forbidden", async () => {
    const { spine } = await world();
    await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "leaving.start",
        args: { employeeId: "meena", separationDate: "2026-09-01" },
      }),
    );
    const res = await spine.submit(
      adapters.fromForm({
        actor: "arun",
        name: "leaving.completeHandover",
        args: { employeeId: "meena", handoverId: "h-course-ai-basics" },
      }),
    );
    expect(res.status).toBe("forbidden");
  });
});

describe("leaving.applySeparation — auto-suspend hook (Phase 6 stub)", () => {
  it("marks the employee separated and suspends their rules", async () => {
    const { spine, deps } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "leaving.applySeparation",
        args: { employeeId: "meena" },
      }),
    );
    expect(res.status).toBe("ran");
    const employee = await deps.graph.getNode("employee", "meena");
    expect(employee?.data.status).toBe("separated");
    expect(employee?.data.suspendedRules).toBe(true);
  });

  it("a scheduled (app-started) separation never auto-graduates (leaving-org)", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromSchedule({
        scheduleId: "sep-tick",
        ruleId: "auto-separate",
        ruleAuthor: "shruti",
        name: "leaving.applySeparation",
        args: { employeeId: "meena" },
      }),
    );
    expect(res.status).toBe("awaiting-confirmation");
    // Two of the gate's checks now catch this, and money-or-people is asked
    // first: separating somebody is people-data, and it is also a `leaving-org`
    // category that can never graduate. Either reason is a correct refusal, so
    // assert the property that matters rather than which check fired.
    expect(["money-or-people", "never-graduate"]).toContain(res.reason);
  });

  it("stays parked no matter how many clean approvals the rule has", async () => {
    // The stronger statement the test above was reaching for: leaving-org is in
    // NEVER_GRADUATE, so no amount of good behaviour lets it run unattended.
    const { spine, autonomy } = await world();
    autonomy.declare("auto-separate-2", "shruti", "leaving.applySeparation", "leaving-org");
    const state = autonomy.get("auto-separate-2")!;
    state.status = "graduated";
    state.cleanCount = 999;
    autonomy.set(state);

    const res = await spine.submit(
      adapters.fromSchedule({
        scheduleId: "sep-tick",
        ruleId: "auto-separate-2",
        ruleAuthor: "shruti",
        name: "leaving.applySeparation",
        args: { employeeId: "meena" },
      }),
    );
    expect(res.status).toBe("awaiting-confirmation");
  });
});

describe("payroll — stays in N1, field-restricted", () => {
  it("pay slip read-through returns nothing in stub mode (data lives in N1)", async () => {
    const { deps } = await world();
    const { PeopleRecordService } = await import("./service");
    const service = new PeopleRecordService(deps.graph, {
      id: "stub",
      async get() {
        return undefined;
      },
      async list() {
        return [];
      },
      async create() {
        throw new Error("stub");
      },
      async update() {
        throw new Error("stub");
      },
    });
    const payslips = await service.listPaySlips("meena");
    expect(payslips).toEqual([]);
  });
});
