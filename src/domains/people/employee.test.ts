import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { accountOfActor, verifyCredentials } from "@/server/accounts";
import { directory } from "@/server/directory";

/**
 * Block 1 — real employee records.
 *
 * The thing these guard is that a person and their login are created together
 * and stay in step. Before this, "add a user" made a login with no record
 * behind it: the person could sign in and then appear in no directory, no team
 * and no assignment list.
 */

/**
 * Accounts live in a module-level map in `accounts.ts`, shared by every test in
 * this file — `buildDemoWorld()` gives a fresh graph but not fresh accounts. So
 * each case gets its own id, rather than reusing one and colliding.
 */
let seq = 0;
function freshId(): string {
  seq += 1;
  return `newjoiner${seq}`;
}

async function addPerson(
  spine: Awaited<ReturnType<typeof buildDemoWorld>>["spine"],
  actor: string,
  overrides: Record<string, unknown> = {},
) {
  const id = (overrides.employeeId as string) ?? freshId();
  const args = {
    employeeId: id,
    name: "Ananya S.",
    role: "employee",
    username: id,
    temporaryPassword: "TempPass2026",
    team: "courses",
    ...overrides,
  };
  const result = await spine.submit(
    adapters.fromForm({ actor, name: "employee.create", args }),
  );
  return { result, id: args.employeeId as string, username: args.username as string };
}

describe("employee.create — the record and the login are one action", () => {
  it("creates both, and the login demands a new password", async () => {
    const { spine, deps } = await buildDemoWorld();
    const { result, id, username } = await addPerson(spine, "shruti");
    expect(result.status).toBe("ran");

    const node = await deps.graph.getNode("employee", id);
    expect(node?.data).toMatchObject({ name: "Ananya S.", status: "active", team: "courses" });

    const signIn = verifyCredentials(username, "TempPass2026");
    expect(signIn).not.toBeNull();
    expect(signIn?.mustChangePassword).toBe(true);
    expect(signIn?.id).toBe(id);
  });

  it("the account's personId equals the employee node id", async () => {
    // `ownerOf("employee", id) === id`, so if these ever diverge every `self`
    // and `own-team` scope fails for that person — silently, because refusal
    // is opaque by design.
    const { spine } = await buildDemoWorld();
    await addPerson(spine, "shruti", { employeeId: "deepa", username: "deepa.s" });
    expect(accountOfActor("deepa")?.username).toBe("deepa.s");
    expect(accountOfActor("deepa")?.personId).toBe("deepa");
  });

  it("the new person can immediately read their own record", async () => {
    const { spine } = await buildDemoWorld();
    const { id } = await addPerson(spine, "shruti");
    const self = await spine.read({ actor: id, nodeType: "employee", nodeId: id });
    expect(self.found).toBe(true);
  });

  it("appears in the directory and is addressable as part of their team", async () => {
    const { spine } = await buildDemoWorld();
    const { id } = await addPerson(spine, "shruti");
    expect(directory().nameOf(id)).toBe("Ananya S.");
    expect(directory().membersOfTeam("courses")).toContain(id);
    // Their manager is the team's manager, with no extra wiring.
    expect(directory().managerOf(id)).toBe("james");
  });

  it("refuses a duplicate id, and leaves no half-made person behind", async () => {
    const { spine, deps } = await buildDemoWorld();
    const { result } = await addPerson(spine, "shruti", { employeeId: "priya", username: "priya2" });
    expect(result.status).toBe("rejected");
    expect(result.missing).toContain("employeeId");
    // priya's real record is untouched.
    const priya = (await deps.graph.getNode("employee", "priya"))?.data as { name: string };
    expect(priya.name).toBe("Priya R.");
    expect(accountOfActor("priya")?.username).not.toBe("priya2");
  });

  it("a taken username rolls the record back rather than leaving it unusable", async () => {
    const { spine, deps } = await buildDemoWorld();
    const { result, id } = await addPerson(spine, "shruti", {
      username: "hr", // already taken by the seeded HR login
    });
    expect(result.status).toBe("rejected");
    expect(result.missing).toContain("username");
    // No record without a way to sign in.
    expect(await deps.graph.getNode("employee", id)).toBeUndefined();
  });

  it("rejects a malformed id and says which argument was wrong", async () => {
    const { spine } = await buildDemoWorld();
    const { result } = await addPerson(spine, "shruti", { employeeId: "Ananya Sharma!" });
    expect(result.status).toBe("rejected");
    expect(result.missing).toContain("employeeId");
  });

  it("names every missing argument at once", async () => {
    const { spine } = await buildDemoWorld();
    const empty = await spine.submit(
      adapters.fromForm({ actor: "shruti", name: "employee.create", args: {} }),
    );
    expect(empty.status).toBe("rejected");
    expect(empty.missing).toEqual(
      expect.arrayContaining(["employeeId", "name", "role", "username", "temporaryPassword"]),
    );
  });

  it("nobody can create a role above their own", async () => {
    const { spine } = await buildDemoWorld();
    const { result } = await addPerson(spine, "james", { role: "admin" });
    expect(result.status).toBe("rejected");
    expect(result.detail).toContain("cannot create");
  });

  it("undo removes the person and their login", async () => {
    const { spine, deps } = await buildDemoWorld();
    const { result, id } = await addPerson(spine, "shruti");
    const undone = await spine.undo(result.activityEntry!.id, "shruti");

    expect(undone.status).toBe("undone");
    expect(await deps.graph.getNode("employee", id)).toBeUndefined();
    expect(accountOfActor(id)).toBeUndefined();
    expect(directory().get(id)).toBeUndefined();
  });
});

describe("employee.deactivate — keeps the history, stops the login", () => {
  it("marks them inactive, keeps the record, and blocks sign-in", async () => {
    const { spine, deps } = await buildDemoWorld();
    const { id, username } = await addPerson(spine, "shruti");

    const gone = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.deactivate",
        args: { employeeId: id, lastWorkingDay: "2026-09-30", reason: "Resigned" },
      }),
    );
    expect(gone.status).toBe("ran");

    // The record survives — leave history, tasks and audit entries still resolve.
    const node = await deps.graph.getNode("employee", id);
    expect(node?.data).toMatchObject({ status: "inactive", lastWorkingDay: "2026-09-30" });

    expect(verifyCredentials(username, "TempPass2026")).toBeNull();
    expect(directory().isActive(id)).toBe(false);
    expect(directory().activeIds()).not.toContain(id);
  });

  it("refuses while they still manage people", async () => {
    const { spine } = await buildDemoWorld();
    // James manages the courses team.
    const blocked = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.deactivate",
        args: { employeeId: "james", lastWorkingDay: "2026-09-30", reason: "Resigned" },
      }),
    );
    expect(blocked.status).toBe("rejected");
    expect(blocked.missing).toContain("reassignReports");
    expect(directory().isActive("james")).toBe(true);
  });

  it("a deactivated person is no longer addressable", async () => {
    const { spine } = await buildDemoWorld();
    const { id } = await addPerson(spine, "shruti");
    await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.deactivate",
        args: { employeeId: id, lastWorkingDay: "2026-09-30", reason: "Resigned" },
      }),
    );
    // Adding "the course team" to a meeting must not invite someone who left.
    const { resolvePeople } = await import("@/domains/workplace/shared/resolve");
    expect(resolvePeople("course team").picks).not.toContain(id);
    expect(resolvePeople([id]).picks).toEqual([]);
  });
});

describe("employee.setPay — money is its own operation", () => {
  it("records pay separately from an ordinary edit", async () => {
    const { spine, deps } = await buildDemoWorld();
    const paid = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.setPay",
        args: { employeeId: "priya", pay: 72000, effectiveFrom: "2026-09-01" },
      }),
    );
    expect(paid.status).toBe("ran");
    expect((await deps.graph.getNode("employee", "priya"))?.data).toMatchObject({
      pay: 72000,
    });

    const entries = await deps.log.query({ operationName: "employee.setPay" });
    expect(entries.length).toBe(1);
  });

  it("cannot be slipped through the general update", async () => {
    const { spine } = await buildDemoWorld();
    const sneaky = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.update",
        args: { employeeId: "priya", patch: { pay: 999999 } },
      }),
    );
    expect(sneaky.status).toBe("rejected");
    expect(sneaky.missing).toContain("pay");
  });

  it("never runs unattended", async () => {
    // Money can never graduate to running on its own (non-negotiable #3).
    const { spine } = await buildDemoWorld();
    const byRule = await spine.submit(
      adapters.fromStandingRule({
        ruleId: "auto-raise",
        ruleAuthor: "shruti",
        name: "employee.setPay",
        args: { employeeId: "priya", pay: 99000, effectiveFrom: "2026-09-01" },
      }),
    );
    expect(byRule.status).toBe("awaiting-confirmation");
  });
});

describe("employee.update", () => {
  it("changes details and undo restores only what changed", async () => {
    const { spine, deps } = await buildDemoWorld();
    const before = (await deps.graph.getNode("employee", "priya"))?.data as {
      pay: number;
      contact: string;
    };

    const edited = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.update",
        args: { employeeId: "priya", patch: { contact: "priya@new.example" } },
      }),
    );
    expect(edited.status).toBe("ran");
    expect(directory().get("priya")?.contact).toBe("priya@new.example");

    await spine.undo(edited.activityEntry!.id, "shruti");
    const after = (await deps.graph.getNode("employee", "priya"))?.data as {
      pay: number;
      contact: string;
    };
    expect(after.contact).toBe(before.contact);
    // Untouched fields are exactly as they were.
    expect(after.pay).toBe(before.pay);
  });
});

/**
 * Reporting lines.
 *
 * `managerId` decides where approvals go, so an unchecked one fails quietly
 * rather than loudly: leave routes to somebody who cannot sign in, and a loop
 * makes both people impossible to deactivate — `employee.deactivate` refuses
 * while you still manage anyone.
 */
describe("manager assignment is checked", () => {
  it("a manager can be set, and drives who approves", async () => {
    const { spine } = await buildDemoWorld();
    const { id } = await addPerson(spine, "shruti", { managerId: "shruti", team: "ops" });
    expect(directory().managerOf(id)).toBe("shruti");
    expect(directory().reportsOf("shruti")).toContain(id);
    expect(directory().chainOfCommand(id)).toEqual(["shruti"]);
  });

  it("refuses a manager who does not exist", async () => {
    const { spine } = await buildDemoWorld();
    const { result } = await addPerson(spine, "shruti", { managerId: "nobody-here" });
    expect(result.status).toBe("rejected");
    expect(result.missing).toContain("managerId");
  });

  it("refuses a manager who has left", async () => {
    const { spine } = await buildDemoWorld();
    const gone = await addPerson(spine, "shruti", { team: "ops" });
    await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.deactivate",
        args: { employeeId: gone.id, lastWorkingDay: "2026-09-30", reason: "Resigned" },
      }),
    );
    const { result } = await addPerson(spine, "shruti", { managerId: gone.id });
    expect(result.status).toBe("rejected");
    expect(result.detail).toContain("has left");
  });

  it("nobody manages themselves", async () => {
    const { spine } = await buildDemoWorld();
    const { id } = await addPerson(spine, "shruti", { team: "ops" });
    const selfManaged = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.update",
        args: { employeeId: id, patch: { managerId: id } },
      }),
    );
    expect(selfManaged.status).toBe("rejected");
    expect(selfManaged.detail).toContain("cannot manage themselves");
  });

  it("refuses a loop", async () => {
    const { spine } = await buildDemoWorld();
    const boss = await addPerson(spine, "shruti", { role: "manager", team: "ops" });
    const report = await addPerson(spine, "shruti", { managerId: boss.id, team: "ops" });

    // Making the boss report to their own report closes the loop.
    const loop = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.update",
        args: { employeeId: boss.id, patch: { managerId: report.id } },
      }),
    );
    expect(loop.status).toBe("rejected");
    expect(loop.missing).toContain("managerId");
  });

  it("chainOfCommand terminates even if bad data slips in", async () => {
    // Belt and braces: the walk is bounded by a seen-set, so a loop written
    // straight into the graph cannot hang a request.
    const { spine, deps } = await buildDemoWorld();
    const a = await addPerson(spine, "shruti", { role: "manager", team: "ops" });
    const b = await addPerson(spine, "shruti", { role: "manager", team: "ops" });

    const nodeA = (await deps.graph.getNode("employee", a.id))!.data as Record<string, unknown>;
    const nodeB = (await deps.graph.getNode("employee", b.id))!.data as Record<string, unknown>;
    await deps.graph.putNode("employee", a.id, { ...nodeA, managerId: b.id });
    await deps.graph.putNode("employee", b.id, { ...nodeB, managerId: a.id });
    await directory().hydrate(deps.graph);

    expect(directory().chainOfCommand(a.id).length).toBeLessThanOrEqual(2);
  });
});
