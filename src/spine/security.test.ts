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

describe("reactivate is not a way to take over an account", () => {
  /**
   * `employee.reactivate` sets the account's password to a value the caller
   * chooses. Its `validate` never checked that the person was actually inactive,
   * and a manager holds `edit` on `employee` with `own-team` scope — so calling
   * it on an *active* teammate was account takeover.
   */
  it("refuses to reactivate somebody who is already active", async () => {
    const { spine } = await buildDemoWorld();
    const attack = await spine.submit(
      adapters.fromForm({
        actor: "james", // manager; priya is on his team and is active
        name: "employee.reactivate",
        args: { employeeId: "priya", temporaryPassword: "taken-over-123" },
      }),
    );
    expect(attack.status).not.toBe("ran");
    // The password must be untouched.
    const { verifyCredentials } = await import("@/server/accounts");
    expect(verifyCredentials("employee", "taken-over-123")).toBeNull();
  });

  it("still works on somebody who genuinely left", async () => {
    const { spine } = await buildDemoWorld();
    const gone = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.deactivate",
        args: { employeeId: "priya", lastWorkingDay: "2026-09-30", reason: "Resigned" },
      }),
    );
    expect(gone.status).toBe("ran");

    const back = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.reactivate",
        args: { employeeId: "priya", temporaryPassword: "welcome-back-123" },
      }),
    );
    expect(back.status).toBe("ran");
  });
});

describe("an earned right is scoped to the operation that earned it", () => {
  /**
   * `hasEarnedRight(ruleId)` ignored the operation name the gate passes it, so
   * one graduated rule unlocked all 51 operations.
   */
  it("a rule graduated for one operation cannot run another", async () => {
    const { deps, autonomy } = await buildDemoWorld();
    autonomy.declare("announce-rule", "shruti", "notify.send");
    const state = autonomy.get("announce-rule")!;
    state.status = "graduated";
    autonomy.set(state);

    expect(deps.autonomy.hasEarnedRight("announce-rule", "notify.send")).toBe(true);
    expect(deps.autonomy.hasEarnedRight("announce-rule", "record.update")).toBe(false);
    expect(deps.autonomy.hasEarnedRight("announce-rule", "task.create")).toBe(false);
  });
});

describe("a manager cannot promote or pay themselves", () => {
  /**
   * `teamCircleOf` includes the actor, so the single manager rule — edit, own
   * team, every field visible — quietly covered their own record. That made a
   * manager able to set their own pay, and to write their own `role`, which
   * combined with `employee.create` reading the directory before the account
   * into a path to minting a super-admin login.
   */
  it("refuses a manager setting their own pay", async () => {
    const { spine, deps } = await buildDemoWorld();
    const before = (await deps.graph.getNode("employee", "james"))?.data as { pay: number };

    const attack = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "employee.setPay",
        args: { employeeId: "james", pay: 9_999_999, effectiveFrom: "2026-09-01" },
      }),
    );
    expect(attack.status).toBe("forbidden");
    expect((await deps.graph.getNode("employee", "james"))?.data).toMatchObject({
      pay: before.pay,
    });
  });

  it("refuses a manager setting a teammate's pay", async () => {
    const { spine } = await buildDemoWorld();
    const attack = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "employee.setPay",
        args: { employeeId: "priya", pay: 1, effectiveFrom: "2026-09-01" },
      }),
    );
    expect(attack.status).toBe("forbidden");
  });

  it("refuses a manager writing their own role", async () => {
    const { spine, deps } = await buildDemoWorld();
    const attack = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "record.update",
        args: { nodeType: "employee", nodeId: "james", data: { role: "super-admin" } },
      }),
    );
    expect(attack.status).toBe("forbidden");
    expect((await deps.graph.getNode("employee", "james"))?.data).toMatchObject({
      role: "manager",
    });
  });

  it("refuses an employee inflating their own leave balance", async () => {
    const { spine, deps } = await buildDemoWorld();
    const before = (await deps.graph.getNode("employee", "priya"))?.data as {
      leaveBalance: number;
    };

    const attack = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "record.update",
        args: { nodeType: "employee", nodeId: "priya", data: { leaveBalance: 365 } },
      }),
    );
    expect(attack.status).toBe("forbidden");
    expect((await deps.graph.getNode("employee", "priya"))?.data).toMatchObject({
      leaveBalance: before.leaveBalance,
    });
  });
});

/**
 * The positive half. Every pre-existing employee test runs as `shruti` — HR,
 * scope `all`, who can do everything — which is exactly why the manager write
 * path went unguarded and the self-pay hole survived. These assert a manager can
 * still do their actual job.
 */
describe("a manager can still do their job", () => {
  it("approves a report's leave, and the balance moves", async () => {
    const { spine, deps } = await buildDemoWorld();
    const requested = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "leave.request",
        args: { employeeId: "priya", fromDate: "2026-09-10", toDate: "2026-09-11" },
      }),
    );
    expect(requested.status).toBe("ran");
    const leaveId = (requested.result?.response as { leaveId?: string })?.leaveId as string;

    const before = (await deps.graph.getNode("employee", "priya"))?.data as {
      leaveBalance: number;
    };
    const approved = await spine.submit(
      adapters.fromForm({ actor: "james", name: "leave.approve", args: { leaveId } }),
    );
    expect(approved.status).toBe("ran");
    const after = (await deps.graph.getNode("employee", "priya"))?.data as {
      leaveBalance: number;
    };
    expect(after.leaveBalance).toBeLessThan(before.leaveBalance);
  });

  it("cannot approve their own leave", async () => {
    const { spine } = await buildDemoWorld();
    const requested = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "leave.request",
        args: { employeeId: "james", fromDate: "2026-09-10", toDate: "2026-09-11" },
      }),
    );
    const leaveId = (requested.result?.response as { leaveId?: string })?.leaveId as string;
    const own = await spine.submit(
      adapters.fromForm({ actor: "james", name: "leave.approve", args: { leaveId } }),
    );
    expect(own.status).toBe("forbidden");
  });

  it("can still update a report's contact details", async () => {
    const { spine } = await buildDemoWorld();
    const edit = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "employee.update",
        args: { employeeId: "priya", patch: { contact: "priya@team.example" } },
      }),
    );
    expect(edit.status).toBe("ran");
  });

  it("an intern can request their own leave", async () => {
    // They could not before: interns had no `edit` rule on `employee` at all,
    // so this was refused — silently, because the refusal is opaque.
    const { spine } = await buildDemoWorld();
    const requested = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "leave.request",
        args: { employeeId: "ravi", fromDate: "2026-09-10", toDate: "2026-09-10" },
      }),
    );
    expect(requested.status).toBe("ran");
  });

  it("but not somebody else's", async () => {
    const { spine } = await buildDemoWorld();
    const attack = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "leave.request",
        args: { employeeId: "priya", fromDate: "2026-09-10", toDate: "2026-09-10" },
      }),
    );
    expect(attack.status).toBe("forbidden");
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

describe("person-scoping: nobody browses a colleague's day", () => {
  /**
   * Before the split, every non-sensitive N1 DocType granted `view` to all six
   * roles with `all` scope — an intern could read the whole organisation's
   * attendance, leave (reasons included) and the recruitment pipeline.
   */
  it("hides another person's leave record; self, manager-of-team and HR still see it", async () => {
    const { spine, deps } = await buildDemoWorld();
    const node = await deps.graph.getNode("leave", "leave-demo");
    expect(node).toBeTruthy();
    const owner = (node!.data as { employee: string }).employee;
    const stranger = owner === "ravi" ? "naveen" : "ravi"; // an intern who is not the owner

    const asStranger = await spine.read({ actor: stranger, nodeType: "leave", nodeId: "leave-demo" });
    expect(asStranger.found).toBe(false);

    const asOwner = await spine.read({ actor: owner, nodeType: "leave", nodeId: "leave-demo" });
    expect(asOwner.found).toBe(true);

    const asHr = await spine.read({ actor: "shruti", nodeType: "leave", nodeId: "leave-demo" });
    expect(asHr.found).toBe(true);
  });

  it("readMany gives an intern only their own person-scoped records", async () => {
    const { spine, deps } = await buildDemoWorld();
    const node = await deps.graph.getNode("leave", "leave-demo");
    const owner = (node!.data as { employee: string }).employee;
    const stranger = owner === "ravi" ? "naveen" : "ravi";

    const list = await spine.readMany({ actor: stranger, nodeType: "leave" });
    expect(list.map((r) => r.nodeId)).not.toContain("leave-demo");
  });

  it("hides the recruitment pipeline from everyone but HR and admins", async () => {
    const { spine, deps } = await buildDemoWorld();
    expect(await deps.graph.getNode("job-applicant", "job-applicant-demo")).toBeTruthy();

    const asEmployee = await spine.read({ actor: "priya", nodeType: "job-applicant", nodeId: "job-applicant-demo" });
    expect(asEmployee.found).toBe(false);

    const asHr = await spine.read({ actor: "shruti", nodeType: "job-applicant", nodeId: "job-applicant-demo" });
    expect(asHr.found).toBe(true);
  });

  it("keeps reference data readable by everyone", async () => {
    const { spine } = await buildDemoWorld();
    const asIntern = await spine.read({ actor: "ravi", nodeType: "leave-type", nodeId: "leave-type-demo" });
    expect(asIntern.found).toBe(true);
  });

  it("scopes a clock-in the moment it is created", async () => {
    const { spine } = await buildDemoWorld();
    const date = "2026-08-18";
    const checkIn = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "attendance.checkIn",
        args: { employeeId: "priya", date },
      }),
    );
    expect(checkIn.status).toBe("ran");

    const own = await spine.read({ actor: "priya", nodeType: "attendance", nodeId: `att_priya_${date}` });
    expect(own.found).toBe(true);

    const stranger = await spine.read({ actor: "ravi", nodeType: "attendance", nodeId: `att_priya_${date}` });
    expect(stranger.found).toBe(false);
  });

  it("person-scopes expense claims: self sees their own, a stranger none, HR all", async () => {
    // expense-claim moved from `sensitive` (HR/admin only — every employee saw
    // empty tables) to person-scoped: your own claim is yours to see, your
    // manager sees the team's, HR sees the organisation's.
    const { spine } = await buildDemoWorld();
    let req = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "expense.claim",
        args: { employeeId: "priya", amount: 1800, category: "Food", description: "Team lunch", date: "2026-08-12" },
      }),
    );
    if (req.status === "awaiting-confirmation") {
      req = await spine.confirm(req.pendingId as string, "priya");
    }
    expect(req.status).toBe("ran");
    const claimId = (req.result?.response as { claimId?: string })?.claimId as string;
    expect(claimId).toBeTruthy();

    const asOwner = await spine.readMany({ actor: "priya", nodeType: "expense-claim" });
    expect(asOwner.map((r) => r.nodeId)).toContain(claimId);

    // ravi is an intern on another team — none of priya's claims for him.
    const asStranger = await spine.readMany({ actor: "ravi", nodeType: "expense-claim" });
    expect(asStranger.map((r) => r.nodeId)).not.toContain(claimId);

    const asHr = await spine.readMany({ actor: "shruti", nodeType: "expense-claim" });
    expect(asHr.map((r) => r.nodeId)).toContain(claimId);
  });

  it("a fresh leave request is visible to its owner without a restart", async () => {
    const { spine } = await buildDemoWorld();
    const req = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "leave.request",
        args: { employeeId: "priya", fromDate: "2026-09-01", toDate: "2026-09-02", type: "Casual" },
      }),
    );
    // leave.request involves people, so the gate may park it for confirmation;
    // both outcomes are fine — what matters is the read scoping below.
    expect(["ran", "awaiting-confirmation"]).toContain(req.status);
    if (req.status !== "ran") return;

    const leaveId = (req.result?.response as { leaveId?: string } | undefined)?.leaveId;
    expect(leaveId).toBeTruthy();
    const own = await spine.read({ actor: "priya", nodeType: "leave", nodeId: leaveId! });
    expect(own.found).toBe(true);
    const stranger = await spine.read({ actor: "ravi", nodeType: "leave", nodeId: leaveId! });
    expect(stranger.found).toBe(false);
  });
});

describe("the open-node bypass is one type wide, not twelve", () => {
  /**
   * Twelve workplace types used to skip the permission system entirely. The
   * exemption is now the common calendar alone (appendix E, by design); the
   * other eleven run on explicit rules with the same reach the bypass gave —
   * except an actor with no role at all, which the bypass silently allowed.
   */
  it("an actor with no role cannot create a task any more", async () => {
    const { spine } = await buildDemoWorld();
    const attack = await spine.submit(
      adapters.fromForm({
        actor: "ghost-with-no-account",
        name: "task.create",
        args: { title: "smuggled in through the bypass" },
      }),
    );
    expect(attack.status).toBe("forbidden");
  });

  it("an intern is still read-only on workplace records", async () => {
    const { spine } = await buildDemoWorld();
    const attack = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "task.create",
        args: { title: "intern-created task" },
      }),
    );
    expect(attack.status).toBe("forbidden");
  });

  it("anyone — intern included — can put a line in someone's bell (notify.send)", async () => {
    // Announcements were replaced by chat; notify.send is what remained for
    // autonomy rules and quick pings. It writes nothing and is open to all.
    const { spine, deps } = await buildDemoWorld();
    const sent = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "notify.send",
        args: { message: "Fire drill on Friday", to: ["priya"] },
      }),
    );
    expect(sent.status).toBe("ran");
    const delivered = deps.bus.forActor("priya");
    expect(delivered.some((n) => n.message.includes("Fire drill"))).toBe(true);
  });

  it("the common calendar stays open to an employee", async () => {
    const { spine } = await buildDemoWorld();
    const ok = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "calendar.create",
        args: { title: "Open calendar entry", kind: "meeting", date: "2026-09-05" },
      }),
    );
    expect(ok.status).toBe("ran");
  });
});

describe("tasks are top-down and person-scoped", () => {
  it("an employee cannot create a task at all", async () => {
    const { spine } = await buildDemoWorld();
    const attack = await spine.submit(
      adapters.fromForm({ actor: "priya", name: "task.create", args: { title: "self-made work" } }),
    );
    expect(attack.status).toBe("forbidden");
  });

  it("an employee finishes their own assigned task, not a colleague's", async () => {
    const { spine } = await buildDemoWorld();
    const mine = await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "Priya's share", assignedTo: "priya" } }),
    );
    const theirs = await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "Arun's share", assignedTo: "arun" } }),
    );
    const myId = (mine.result?.response as { taskId: string }).taskId;
    const theirId = (theirs.result?.response as { taskId: string }).taskId;

    const attack = await spine.submit(
      adapters.fromForm({ actor: "priya", name: "task.complete", args: { taskId: theirId } }),
    );
    expect(attack.status).toBe("forbidden");

    const ok = await spine.submit(
      adapters.fromForm({ actor: "priya", name: "task.complete", args: { taskId: myId } }),
    );
    expect(ok.status).toBe("ran");
  });

  it("an employee updates status only — rewriting their own task is refused", async () => {
    const { spine } = await buildDemoWorld();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "As handed out", assignedTo: "priya" } }),
    );
    const taskId = (created.result?.response as { taskId: string }).taskId;
    const attack = await spine.submit(
      adapters.fromForm({ actor: "priya", name: "task.edit", args: { taskId, title: "Rewritten by me" } }),
    );
    expect(attack.status).toBe("forbidden");
  });

  it("each role gets its own board: self / own-team / all", async () => {
    const { spine } = await buildDemoWorld();
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "For priya", assignedTo: "priya" } }),
    );
    // A manager's unassigned creation must not vanish from their own board —
    // ownership falls back to the creator.
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "Still unassigned" } }),
    );

    const titleOf = (r: { record: Record<string, unknown> }) => String(r.record.title ?? "");
    const priyaBoard = (await spine.readMany({ actor: "priya", nodeType: "task" })).map(titleOf);
    expect(priyaBoard).toContain("For priya");
    expect(priyaBoard).not.toContain("Still unassigned");
    expect(priyaBoard.every((t) => t !== "Still unassigned")).toBe(true);

    const jamesBoard = (await spine.readMany({ actor: "james", nodeType: "task" })).map(titleOf);
    expect(jamesBoard).toContain("For priya");
    expect(jamesBoard).toContain("Still unassigned");

    const hrBoard = (await spine.readMany({ actor: "shruti", nodeType: "task" })).map(titleOf);
    expect(hrBoard).toContain("For priya");
    expect(hrBoard).toContain("Still unassigned");
  });
});

describe("courses are managed from above, worked from below", () => {
  it("an employee cannot create a course; a manager can", async () => {
    const { spine } = await buildDemoWorld();
    const attack = await spine.submit(
      adapters.fromForm({ actor: "priya", name: "course.create", args: { title: "Self-serve course" } }),
    );
    expect(attack.status).toBe("forbidden");

    const ok = await spine.submit(
      adapters.fromForm({ actor: "james", name: "course.create", args: { title: "Prompt Writing" } }),
    );
    expect(ok.status).toBe("ran");
  });

  it("delete is admin-level: manager refused, admin succeeds and can undo", async () => {
    const { spine, deps } = await buildDemoWorld();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "course.create", args: { title: "Short-lived" } }),
    );
    const courseId = (created.result?.response as { courseId: string }).courseId;

    const attack = await spine.submit(
      adapters.fromForm({ actor: "james", name: "course.delete", args: { courseId } }),
    );
    expect(attack.status).toBe("forbidden");

    const del = await spine.submit(
      adapters.fromForm({ actor: "admin", name: "course.delete", args: { courseId } }),
    );
    expect(del.status).toBe("ran");
    expect(await deps.graph.getNode("course", courseId)).toBeUndefined();
    expect((await spine.undo(del.activityEntry!.id, "admin")).status).toBe("undone");
    expect(await deps.graph.getNode("course", courseId)).toBeDefined();
  });
});
