import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { isRestricted } from "@/spine/permission/types";
import { PeopleRecordService } from "./service";
import { resetEnvCache } from "@/config/env";
import type { N1Provider, N1Record } from "@/config/providers";

function world() {
  return buildDemoWorld();
}

async function requestLeave(
  spine: ReturnType<typeof buildDemoWorld>["spine"],
  employeeId: string,
  fromDate: string,
  toDate: string,
) {
  const res = await spine.submit(
    adapters.fromTyped({
      actor: employeeId,
      name: "leave.request",
      args: { employeeId, fromDate, toDate },
    }),
  );
  return res;
}

type LeaveResponse = {
  leaveId: string;
  clashes: Array<{ type: string }>;
  approver?: string;
};

function leaveResponse(res: { result?: { response?: unknown } }): LeaveResponse {
  return res.result?.response as LeaveResponse;
}

describe("leave.request — creates a leave node + resolves approver", () => {
  it("creates a Pending leave node and publishes to the team lead", async () => {
    const { spine, deps } = world();
    const res = await requestLeave(spine, "priya", "2026-08-10", "2026-08-12");
    expect(res.status).toBe("ran");
    const { leaveId, approver } = leaveResponse(res);
    expect(leaveId).toBeTruthy();
    const node = deps.graph.getNode("leave", leaveId);
    expect(node?.data.status).toBe("Pending");
    expect(node?.data.employeeId).toBe("priya");
    expect(approver).toBe("james");
  });
});

describe("leave clash check — flagged to the approver, not blocking", () => {
  it("detects an overlapping pending leave on a second request", async () => {
    const { spine } = world();
    await requestLeave(spine, "priya", "2026-08-10", "2026-08-12");
    const second = await requestLeave(spine, "priya", "2026-08-11", "2026-08-13");
    expect(second.status).toBe("ran");
    expect(leaveResponse(second).clashes.length).toBe(1);
    expect(leaveResponse(second).clashes[0].type).toBe("leave");
  });

  it("finds no clash for a non-overlapping window", async () => {
    const { spine } = world();
    await requestLeave(spine, "priya", "2026-08-01", "2026-08-03");
    const second = await requestLeave(spine, "priya", "2026-08-10", "2026-08-12");
    expect(leaveResponse(second).clashes.length).toBe(0);
  });
});

describe("leave.approve / leave.decline — recorded, undoable, gated", () => {
  it("a manager approves a team member's leave (recorded + undoable)", async () => {
    const { spine, deps } = world();
    const req = await requestLeave(spine, "priya", "2026-08-10", "2026-08-12");
    const leaveId = leaveResponse(req).leaveId;

    const approve = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "leave.approve",
        args: { leaveId },
      }),
    );
    expect(approve.status).toBe("ran");
    expect(approve.activityEntry?.changes[0]?.after).toMatchObject({
      status: "Approved",
      approvedBy: "james",
    });
    expect(deps.graph.getNode("leave", leaveId)?.data.status).toBe("Approved");

    const undone = await spine.undo(approve.activityEntry!.id, "james");
    expect(undone.status).toBe("undone");
    expect(deps.graph.getNode("leave", leaveId)?.data.status).toBe("Pending");
  });

  it("a manager declines with a reason", async () => {
    const { spine, deps } = world();
    const req = await requestLeave(spine, "priya", "2026-08-10", "2026-08-12");
    const leaveId = leaveResponse(req).leaveId;

    const decline = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "leave.decline",
        args: { leaveId, reason: "Too many people off that week." },
      }),
    );
    expect(decline.status).toBe("ran");
    expect(deps.graph.getNode("leave", leaveId)?.data.status).toBe("Declined");
    expect(deps.graph.getNode("leave", leaveId)?.data.reason).toContain(
      "Too many people",
    );
  });

  it("a non-manager cannot approve (forbidden, opaque)", async () => {
    const { spine } = world();
    const req = await requestLeave(spine, "priya", "2026-08-10", "2026-08-12");
    const leaveId = leaveResponse(req).leaveId;
    const res = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "leave.approve",
        args: { leaveId },
      }),
    );
    expect(res.status).toBe("forbidden");
  });
});

describe("PeopleRecordService — N1 read-through (field perms still apply)", () => {
  const fakeN1: N1Provider = {
    id: "fake",
    async get(_dt: string, name: string): Promise<N1Record | undefined> {
      if (name === "priya") {
        return {
          doctype: "Employee",
          name,
          data: {
            employee: "priya",
            employee_name: "Priya R.",
            designation: "course-writer",
            orga_team: "courses",
            orga_role: "employee",
            cell_number: "priya@orga.example",
            ctc: 99999,
            status: "Active",
          },
        };
      }
      return undefined;
    },
    async list(): Promise<N1Record[]> {
      return [];
    },
    async create(): Promise<N1Record> {
      throw new Error("not used");
    },
    async update(): Promise<N1Record> {
      throw new Error("not used");
    },
  };

  beforeEach(() => {
    process.env.N1_BASE_URL = "https://n1.example";
    process.env.N1_API_KEY = "k";
    process.env.N1_API_SECRET = "s";
    resetEnvCache();
  });

  afterEach(() => {
    delete process.env.N1_BASE_URL;
    delete process.env.N1_API_KEY;
    delete process.env.N1_API_SECRET;
    resetEnvCache();
  });

  it("caches an N1 employee into the graph (hr sees the live pay)", async () => {
    const { spine, deps } = world();
    const service = new PeopleRecordService(deps.graph, fakeN1);
    await service.getEmployee("priya");
    expect(deps.graph.getNode("employee", "priya")?.data.pay).toBe(99999);
    const read = spine.read({
      actor: "shruti",
      nodeType: "employee",
      nodeId: "priya",
    });
    expect(read.found).toBe(true);
    if (read.found) expect(read.record.pay).toBe(99999);
  });

  it("still field-restricts pay for an employee viewer after read-through", async () => {
    const { spine, deps } = world();
    const service = new PeopleRecordService(deps.graph, fakeN1);
    await service.getEmployee("priya");
    const read = spine.read({
      actor: "arun",
      nodeType: "employee",
      nodeId: "priya",
    });
    expect(read.found).toBe(true);
    if (read.found) expect(isRestricted(read.record.pay)).toBe(true);
  });
});
