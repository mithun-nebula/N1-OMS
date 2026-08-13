import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";

/**
 * Phase 0 — the two attack chains, and the disclosure holes.
 *
 * These were found by a 12-agent audit and verified line by line. Every case
 * here failed before the fix: each one is a real thing a signed-in employee
 * could do against the live database.
 *
 * They are written as attacks rather than as unit tests on purpose — a unit
 * test on `record.update` would have passed the whole time.
 */

describe("an employee cannot change their own pay", () => {
  /**
   * `record.update` declared its permission need without naming the fields it
   * writes, so the field check never ran (`permission/policy.ts:54` only tests
   * fields when it is told which ones). The employee/self/edit rule marks pay
   * restricted and was never consulted. Own record is in `self` scope.
   */
  it("refuses a pay write through the generic record update", async () => {
    const { spine, deps } = await buildDemoWorld();
    const before = (await deps.graph.getNode("employee", "priya"))?.data as { pay: number };

    const attack = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "record.update",
        args: { nodeType: "employee", nodeId: "priya", data: { pay: 9_999_999 } },
      }),
    );

    expect(attack.status).toBe("forbidden");
    const after = (await deps.graph.getNode("employee", "priya"))?.data as { pay: number };
    expect(after.pay).toBe(before.pay);
  });

  it("still allows an employee to edit a field they own", async () => {
    // The fix must not break the legitimate case it sits next to.
    const { spine, deps } = await buildDemoWorld();
    const ok = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "employee.updateContact",
        args: { employeeId: "priya", contact: "priya@new.example" },
      }),
    );
    expect(ok.status).toBe("ran");
    expect((await deps.graph.getNode("employee", "priya"))?.data).toMatchObject({
      contact: "priya@new.example",
    });
  });

  it("refuses a pay write on somebody else's record too", async () => {
    const { spine } = await buildDemoWorld();
    const attack = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "record.update",
        args: { nodeType: "employee", nodeId: "james", data: { pay: 1 } },
      }),
    );
    expect(attack.status).toBe("forbidden");
  });
});

describe("delegated authority cannot be forged", () => {
  /**
   * Step 2 of the chain: confirming your own parked operation called
   * `recordOutcome`, which declared a rule into the ledger. That is an
   * undocumented rule-creation API — a rule authored by you, persisted, that
   * nobody granted.
   */
  it("submitting under a rule that does not exist does not create one", async () => {
    const { spine, autonomy } = await buildDemoWorld();

    const parked = await spine.submit(
      adapters.fromStandingRule({
        ruleId: "invented-rule",
        ruleAuthor: "priya",
        name: "task.create",
        args: { title: "a" },
      }),
    );

    if (parked.status === "awaiting-confirmation") {
      await spine.confirm(parked.pendingId as string, "priya");
    }
    expect(autonomy.get("invented-rule")).toBeUndefined();
  });

  it("a rule cannot graduate without its ten clean approvals", async () => {
    const { autonomy, deps, spine } = await buildDemoWorld();
    const { AutonomyEngine } = await import("@/domains/autonomy/engine");
    const engine = new AutonomyEngine(autonomy, spine, deps.graph, deps.log, deps.bus);

    autonomy.declare("selfmade", "priya", "task.create");
    // `CLEAN_APPROVALS_TO_GRADUATE = 10` was read only by offerGraduation,
    // which decides when to *notify* — never whether graduation is permitted.
    expect(engine.acceptGraduation("selfmade", "priya")).toBe(false);
    expect(autonomy.get("selfmade")?.status).toBe("supervised");
  });

  it("only the rule's author can revoke it", async () => {
    const { autonomy, deps, spine } = await buildDemoWorld();
    const { AutonomyEngine } = await import("@/domains/autonomy/engine");
    const engine = new AutonomyEngine(autonomy, spine, deps.graph, deps.log, deps.bus);

    autonomy.declare("james-rule", "james", "task.create");
    // `revoke(ruleId, _actor)` ignored its actor entirely.
    expect(engine.revoke("james-rule", "ravi")).toBe(false);
    expect(engine.revoke("james-rule", "james")).toBe(true);
  });
});

describe("an earned right is scoped to the operation that earned it", () => {
  /**
   * `hasEarnedRight(ruleId)` ignored the operation name the gate passes it, so
   * one graduated rule unlocked all 51 operations.
   */
  it("a rule graduated for one operation cannot run another", async () => {
    const { deps, autonomy } = await buildDemoWorld();
    autonomy.declare("announce-rule", "shruti", "announcement.send");
    const state = autonomy.get("announce-rule")!;
    state.status = "graduated";
    autonomy.set(state);

    expect(deps.autonomy.hasEarnedRight("announce-rule", "announcement.send")).toBe(true);
    expect(deps.autonomy.hasEarnedRight("announce-rule", "record.update")).toBe(false);
    expect(deps.autonomy.hasEarnedRight("announce-rule", "task.create")).toBe(false);
  });
});

describe("undo is not a way around the gate", () => {
  /**
   * `Spine.undo` took an actor and made no permission check at all. With
   * `GET /api/activity` returning every entry to any session, that was: read
   * the log, find the pay change, reverse it.
   */
  it("someone who could not have made the change cannot undo it", async () => {
    const { spine, deps } = await buildDemoWorld();

    const paid = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.setPay",
        args: { employeeId: "priya", pay: 72000, effectiveFrom: "2026-09-01" },
      }),
    );
    expect(paid.status).toBe("ran");

    const attack = await spine.undo(paid.activityEntry!.id, "ravi");
    expect(attack.status).not.toBe("undone");

    expect((await deps.graph.getNode("employee", "priya"))?.data).toMatchObject({
      pay: 72000,
    });
  });

  it("someone who could have made the change can still undo it", async () => {
    const { spine, deps } = await buildDemoWorld();
    const before = (await deps.graph.getNode("employee", "priya"))?.data as { pay: number };

    const paid = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.setPay",
        args: { employeeId: "priya", pay: 81000, effectiveFrom: "2026-09-01" },
      }),
    );
    const undone = await spine.undo(paid.activityEntry!.id, "shruti");

    expect(undone.status).toBe("undone");
    expect((await deps.graph.getNode("employee", "priya"))?.data).toMatchObject({
      pay: before.pay,
    });
  });
});

describe("a refusal never discloses what it is hiding", () => {
  /**
   * Non-negotiable #2. Argument validation ran *before* the permission check
   * and its message was returned verbatim, so a rejection named records,
   * states and whole reporting lines. Introduced while building Block 1.
   */
  it("does not name the people in someone's reporting line", async () => {
    const { spine } = await buildDemoWorld();
    const refused = await spine.submit(
      adapters.fromForm({
        actor: "ravi", // an intern, with no business deactivating anyone
        name: "employee.deactivate",
        args: { employeeId: "james", lastWorkingDay: "2026-09-30", reason: "x" },
      }),
    );

    const body = JSON.stringify(refused);
    for (const leak of ["Priya", "Arun", "Karthik", "Divya", "Meena", "James"]) {
      expect(body).not.toContain(leak);
    }
  });

  it("does not reveal whether a record exists", async () => {
    const { spine } = await buildDemoWorld();

    const real = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "employee.deactivate",
        args: { employeeId: "james", lastWorkingDay: "2026-09-30", reason: "x" },
      }),
    );
    const imaginary = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "employee.deactivate",
        args: { employeeId: "nobody-by-that-name", lastWorkingDay: "2026-09-30", reason: "x" },
      }),
    );

    // Byte-identical, or the difference is the oracle.
    expect(JSON.stringify(imaginary)).toBe(JSON.stringify(real));
  });
});
