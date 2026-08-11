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

  it("can view open node types but cannot create/edit them", async () => {
    const { deps } = await world();
    expect(
      deps.permissions.can({ actor: "ravi", action: "view", nodeType: "task" })
        .allowed,
    ).toBe(true);
    expect(
      deps.permissions.can({ actor: "ravi", action: "create", nodeType: "task" })
        .allowed,
    ).toBe(false);
    expect(
      deps.permissions.can({ actor: "ravi", action: "edit", nodeType: "task" })
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
    const { deps } = await world();
    expect(
      deps.permissions
        .can({ actor: "priya", action: "create", nodeType: "task" })
        .allowed,
    ).toBe(true);
    expect(
      deps.permissions
        .can({ actor: "priya", action: "edit", nodeType: "calendar-entry" })
        .allowed,
    ).toBe(true);
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
