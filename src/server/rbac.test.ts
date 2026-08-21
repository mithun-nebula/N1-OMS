import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "./bootstrap";
import * as adapters from "@/spine/adapters";
import { isRestricted } from "@/spine/permission/types";

function world() {
  return buildDemoWorld();
}

describe("rbac — super-admin", () => {
  it("can perform every action on managed records", async () => {
    const { deps } = await world();
    for (const action of ["view", "create", "edit", "approve", "export", "delete"] as const) {
      const decision = deps.permissions.can({
        actor: "superadmin",
        action,
        nodeType: "employee",
      });
      expect(decision.allowed, action).toBe(true);
    }
  });

  it("can edit any course through the gate", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "superadmin",
        name: "course.updateStage",
        args: { courseId: "spreadsheet-automation", stage: "draft" },
      }),
    );
    expect(res.status).toBe("ran");
  });
});

describe("rbac — admin (no delete; delete reserved for super-admin)", () => {
  it("can export but cannot delete", async () => {
    const { deps } = await world();
    expect(
      deps.permissions.can({ actor: "admin", action: "export", nodeType: "employee" }).allowed,
    ).toBe(true);
    expect(
      deps.permissions.can({ actor: "admin", action: "delete", nodeType: "employee" }).allowed,
    ).toBe(false);
  });
});

describe("rbac — hr sees pay", () => {
  it("reads employee pay as a number", async () => {
    const { spine } = await world();
    const read = await spine.read({ actor: "shruti", nodeType: "employee", nodeId: "priya" });
    expect(read.found).toBe(true);
    if (read.found) {
      expect(isRestricted(read.record.pay)).toBe(false);
    }
  });
});

describe("rbac — employee cannot export", () => {
  it("export is denied to employees", async () => {
    const { spine } = await world();
    expect(spine.canExport("priya", "employee")).toBe(false);
  });
});

describe("rbac — intern is read-only", () => {
  it("cannot edit a course (forbidden, opaque)", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "course.updateStage",
        args: { courseId: "ai-presentations", stage: "draft" },
      }),
    );
    expect(res.status).toBe("forbidden");
    expect(JSON.stringify(res)).not.toContain("ai-presentations");
  });

  it("has no edit permission on courses", async () => {
    const { deps } = await world();
    expect(
      deps.permissions.can({
        actor: "ravi",
        action: "edit",
        nodeType: "course",
      }).allowed,
    ).toBe(false);
  });

  it("cannot read a course outside its team (scope-denied, opaque)", async () => {
    const { spine } = await world();
    const read = await spine.read({
      actor: "ravi",
      nodeType: "course",
      nodeId: "ai-presentations",
    });
    expect(read.found).toBe(false);
  });

  it("sees only their own tasks, and cannot create/edit any", async () => {
    // Tasks moved from the open reach to role-scoped views: an intern's board
    // holds only what is assigned to them.
    const { spine, deps } = await world();
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "Ravi's share", assignedTo: "ravi" } }),
    );
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "Priya's share", assignedTo: "priya" } }),
    );
    const board = await spine.readMany({ actor: "ravi", nodeType: "task" });
    expect(board.some((r) => (r.record as { title?: string }).title === "Ravi's share")).toBe(true);
    expect(board.some((r) => (r.record as { title?: string }).title === "Priya's share")).toBe(false);
    expect(
      deps.permissions.can({ actor: "ravi", action: "create", nodeType: "task" })
        .allowed,
    ).toBe(false);
  });

  it("cannot create a task / book a room / schedule a meeting through the gate", async () => {
    const { spine } = await world();
    const task = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "task.create",
        args: { title: "should not exist" },
      }),
    );
    expect(task.status).toBe("forbidden");

    const room = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "room.book",
        args: { roomId: "hall-1", title: "should not book", from: "2026-08-20T10:00", to: "2026-08-20T11:00" },
      }),
    );
    expect(room.status).toBe("forbidden");

    const meeting = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "calendar.create",
        args: { title: "x", kind: "meeting", date: "2026-08-20" },
      }),
    );
    expect(meeting.status).toBe("forbidden");
  });

  it("an employee (non-read-only) can still create/edit open types", async () => {
    // Tasks left this list (top-down: manager+ create) — documents and the
    // calendar are the remaining open-reach examples.
    const { deps } = await world();
    expect(
      deps.permissions
        .can({ actor: "priya", action: "create", nodeType: "document" })
        .allowed,
    ).toBe(true);
    expect(
      deps.permissions
        .can({ actor: "priya", action: "edit", nodeType: "calendar-entry" })
        .allowed,
    ).toBe(true);
    expect(
      deps.permissions
        .can({ actor: "priya", action: "create", nodeType: "task" })
        .allowed,
    ).toBe(false);
  });
});

describe("rbac — manager approves people actions (always asks)", () => {
  it("a standing-rule people action still needs confirmation even for a manager-owned rule", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromStandingRule({
        ruleId: "auto-leave",
        ruleAuthor: "james",
        name: "leave.request",
        args: {
          employeeId: "priya",
          fromDate: "2026-08-08",
          toDate: "2026-08-08",
        },
      }),
    );
    expect(res.status).toBe("awaiting-confirmation");
    expect(res.reason).toBe("money-or-people");
  });
});
