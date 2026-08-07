import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "./bootstrap";
import * as adapters from "@/spine/adapters";
import { isRestricted } from "@/spine/permission/types";

function world() {
  return buildDemoWorld();
}

describe("rbac — super-admin", () => {
  it("can perform every action on managed records", () => {
    const { deps } = world();
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
    const { spine } = world();
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
  it("can export but cannot delete", () => {
    const { deps } = world();
    expect(
      deps.permissions.can({ actor: "admin", action: "export", nodeType: "employee" }).allowed,
    ).toBe(true);
    expect(
      deps.permissions.can({ actor: "admin", action: "delete", nodeType: "employee" }).allowed,
    ).toBe(false);
  });
});

describe("rbac — hr sees pay", () => {
  it("reads employee pay as a number", () => {
    const { spine } = world();
    const read = spine.read({ actor: "shruti", nodeType: "employee", nodeId: "priya" });
    expect(read.found).toBe(true);
    if (read.found) {
      expect(isRestricted(read.record.pay)).toBe(false);
    }
  });
});

describe("rbac — employee cannot export", () => {
  it("export is denied to employees", () => {
    const { spine } = world();
    expect(spine.canExport("priya", "employee")).toBe(false);
  });
});

describe("rbac — intern is read-only", () => {
  it("cannot edit a course (forbidden, opaque)", async () => {
    const { spine } = world();
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

  it("has no edit permission on courses", () => {
    const { deps } = world();
    expect(
      deps.permissions.can({
        actor: "ravi",
        action: "edit",
        nodeType: "course",
      }).allowed,
    ).toBe(false);
  });

  it("cannot read a course outside its team (scope-denied, opaque)", () => {
    const { spine } = world();
    const read = spine.read({
      actor: "ravi",
      nodeType: "course",
      nodeId: "ai-presentations",
    });
    expect(read.found).toBe(false);
  });
});

describe("rbac — manager approves people actions (always asks)", () => {
  it("a standing-rule people action still needs confirmation even for a manager-owned rule", async () => {
    const { spine } = world();
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
