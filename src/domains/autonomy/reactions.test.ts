import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { AutonomyEngine } from "./engine";
import { applyAutonomyReactions, applyAutonomyReactionsFromEntry } from "./reactions";

/**
 * "A rule never outlives its owner" (CONTEXT.md §13 #4).
 *
 * `suspendAuthor` existed with zero production callers, so separating somebody
 * left their graduated rules running under their authority. These tests hold
 * the wire that closes that — and, above all, hold it on the **confirm** path,
 * because `employee.deactivate` parks by design and never reaches the direct
 * route in production.
 */

let world: DemoWorld;
let engine: AutonomyEngine;

beforeEach(async () => {
  world = await buildDemoWorld();
  engine = new AutonomyEngine(
    world.autonomy,
    world.spine,
    world.deps.graph,
    world.deps.log,
    world.deps.bus,
  );
});

/** A graduated rule of priya's — the kind that runs unattended. */
function priyaHasAGraduatedRule(ruleId = "priya-standing") {
  const state = world.autonomy.declare(ruleId, "priya", "notify.send", "routine");
  state.status = "graduated";
  world.autonomy.set(state);
  return state;
}

describe("a departed person's rules stop with them", () => {
  /**
   * Both routes carry real traffic, and the plan for this phase had it the
   * wrong way round. Every parking condition in `gate.ts` is guarded by
   * `delegated` — so HR deactivating somebody through the form does **not**
   * park; it runs and lands on `/api/operations`. Only a rule-driven
   * deactivation parks and reaches the confirm route. Hooking either one alone
   * leaves a live hole, so both are tested.
   */

  it("HR deactivating by hand runs straight through — and suspends her rules", async () => {
    priyaHasAGraduatedRule();

    const submitted = await world.spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "employee.deactivate",
        args: { employeeId: "priya", lastWorkingDay: "2026-08-31", reason: "resigned" },
      }),
    );
    // A person start is never parked by the gate, whatever its category.
    expect(submitted.status).toBe("ran");

    // Exactly what /api/operations does after a successful write.
    await applyAutonomyReactions(
      "employee.deactivate",
      { employeeId: "priya", lastWorkingDay: "2026-08-31", reason: "resigned" },
      { engine },
    );

    const rule = world.autonomy.get("priya-standing");
    expect(rule?.status).toBe("suspended");
    expect(rule?.suspendedReason).toBe("author deactivated");
  });

  it("a rule-driven deactivation parks — and confirming it suspends her rules", async () => {
    priyaHasAGraduatedRule();
    // Shruti's own rule, which would deactivate people unattended if it could.
    world.autonomy.declare("hr-offboard", "shruti", "employee.deactivate", "leaving-org");

    const submitted = await world.spine.submit(
      adapters.fromStandingRule({
        ruleId: "hr-offboard",
        ruleAuthor: "shruti",
        name: "employee.deactivate",
        args: { employeeId: "priya", lastWorkingDay: "2026-08-31", reason: "resigned" },
      }),
    );

    // The trap, asserted rather than assumed: this one does not run, it parks.
    // Anything hooked only to the direct path would never see it.
    expect(submitted.status).toBe("awaiting-confirmation");
    expect(world.autonomy.get("priya-standing")?.status).toBe("graduated");

    // Exactly what /api/operations/[id]/confirm does after a release.
    const confirmed = await world.spine.confirm(submitted.pendingId!, "shruti");
    expect(confirmed.status).toBe("ran");
    await applyAutonomyReactionsFromEntry(confirmed.activityEntry!, { engine });

    const rule = world.autonomy.get("priya-standing");
    expect(rule?.status).toBe("suspended");
    expect(rule?.suspendedReason).toBe("author deactivated");
  });

  it("recovers the employee id from the entry, not from the arguments", async () => {
    priyaHasAGraduatedRule();
    // The confirm path has an entry and no call, so id recovery is the whole
    // mechanism. `changes` is all it gets.
    await applyAutonomyReactionsFromEntry(
      {
        operationName: "employee.deactivate",
        changes: [
          { nodeType: "offboarding", nodeId: "off_priya" },
          { nodeType: "employee", nodeId: "priya" },
        ],
      },
      { engine },
    );
    expect(world.autonomy.get("priya-standing")?.status).toBe("suspended");
  });

  it("separation suspends them too", async () => {
    priyaHasAGraduatedRule();
    await applyAutonomyReactions(
      "leaving.applySeparation",
      { employeeId: "priya" },
      { engine },
    );
    const rule = world.autonomy.get("priya-standing");
    expect(rule?.status).toBe("suspended");
    expect(rule?.suspendedReason).toBe("author separated");
  });

  it("leaves everybody else's rules alone", async () => {
    priyaHasAGraduatedRule();
    const james = world.autonomy.declare("james-standing", "james", "notify.send", "routine");
    james.status = "graduated";
    world.autonomy.set(james);

    await applyAutonomyReactions("employee.deactivate", { employeeId: "priya" }, { engine });

    expect(world.autonomy.get("priya-standing")?.status).toBe("suspended");
    expect(world.autonomy.get("james-standing")?.status).toBe("graduated");
  });

  it("an unrelated operation changes nothing", async () => {
    priyaHasAGraduatedRule();
    await applyAutonomyReactions("task.complete", { employeeId: "priya" }, { engine });
    expect(world.autonomy.get("priya-standing")?.status).toBe("graduated");
  });

  it("cannot fail the write it followed", async () => {
    const throwing = {
      suspendAuthor(): string[] {
        throw new Error("the store is down");
      },
    };
    await expect(
      applyAutonomyReactions("employee.deactivate", { employeeId: "priya" }, { engine: throwing }),
    ).resolves.toBeUndefined();
  });
});

/**
 * The wire itself, not just the function behind it.
 *
 * Every domain test above would still pass with both routes unhooked — which
 * is exactly how the original bug survived review. These read the routes and
 * insist the calls are there.
 */
describe("both routes are hooked", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the confirm route calls the reaction — the path deactivation actually takes", () => {
    const source = read("src/app/api/operations/[id]/confirm/route.ts");
    expect(source).toContain("applyAutonomyReactionsFromEntry");
  });

  it("the direct route calls it too", () => {
    const source = read("src/app/api/operations/route.ts");
    expect(source).toContain("applyAutonomyReactions(");
  });
});

describe("revoking somebody else's rule", () => {
  it("an admin can; a bystander cannot", () => {
    priyaHasAGraduatedRule();
    expect(engine.revoke("priya-standing", "arun")).toBe(false);
    expect(world.autonomy.get("priya-standing")?.status).toBe("graduated");

    expect(engine.revoke("priya-standing", "admin", { isAdmin: true })).toBe(true);
    expect(world.autonomy.get("priya-standing")?.status).toBe("supervised");
  });

  it("the rules route passes isAdmin — without it an admin can only revoke their own", () => {
    const source = readFileSync("src/app/api/autonomy/rules/route.ts", "utf8");
    expect(source).toContain("isAdmin");
  });
});
