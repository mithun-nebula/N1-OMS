import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";

/**
 * What actually decides whether an operation parks.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Phase 3's plan opens with a precondition it says blocks the whole phase:
 *
 *   "Parking is decided by `involvesMoneyOrPeople`, not by `category`.
 *    `category` does not appear in any parking condition. It is used
 *    elsewhere, and setting it does NOT make an operation park."
 *
 * **That is false.** It quotes `gate.ts:94` and stops reading four lines early:
 *
 *   :94   if (handler.involvesMoneyOrPeople(operation.args) && delegated)
 *   :98   const category = handler.category;
 *   :99   if (delegated && category && this.autonomy.neverGraduates(category))
 *
 * and `NEVER_GRADUATE` (`gate/autonomy.ts:35`) is `{money, people, leaving-org}`.
 * So `category` **is** a parking condition — the second of two.
 *
 * These tests pin the real behaviour, so the next person to plan against it
 * reads the code rather than a summary of it.
 */

describe("what parks, and why — both branches", () => {
  /**
   * The operations the Phase 3 plan lists as "the hole Phase 0.3 was written to
   * close is still open". They declare `category: "people"` and
   * `involvesMoneyOrPeople: false`, and they park anyway.
   */
  for (const [name, args] of [
    ["course.assign", { courseId: "c1", assignees: ["priya"] }],
    ["employee.updateContact", { employeeId: "priya", contact: "x@example.com" }],
  ] as const) {
    it(`${name} DOES park under delegated authority, via category`, async () => {
      const { spine } = await buildDemoWorld();
      const out = await spine.submit(
        adapters.fromStandingRule({
          ruleId: "rule-audit",
          ruleAuthor: "james",
          name,
          args: args as Record<string, unknown>,
        }),
      );
      // Not "ran". The never-graduate branch caught it.
      expect(out.status).toBe("awaiting-confirmation");
    });
  }

  it("a hand-filled form never parks, on either branch", async () => {
    // BOTH conditions require `delegated`. So flipping involvesMoneyOrPeople
    // would NOT add a tap for somebody using a screen — which is the reason
    // course.assign's own comment gives for leaving it false, and that reason
    // does not hold.
    //
    // Asserted as "did not park" rather than "ran": whether the args happen to
    // satisfy validate() is a different question, and pinning it here would
    // make this test fragile about something it is not testing.
    const { spine } = await buildDemoWorld();
    for (const [actor, name, args] of [
      ["shruti", "employee.setPay", { employeeId: "priya", amount: 1, effectiveFrom: "2026-09-01" }],
      ["james", "course.assign", { courseId: "c1", assignees: ["priya"] }],
      ["james", "employee.updateContact", { employeeId: "priya", contact: "x@example.com" }],
    ] as const) {
      const out = await spine.submit(
        adapters.fromForm({ actor, name, args: args as Record<string, unknown> }),
      );
      expect(out.status, name).not.toBe("awaiting-confirmation");
    }
  });

  /**
   * ⚠ THE HOLE PHASE 3 ACTUALLY HAS TO CLOSE — and it is the test above.
   *
   * Both parking branches require `delegated`. An agent submitting
   * `start: "typed"` produces `authority: {kind:"self"}`, so `delegated` is
   * false and NEITHER branch fires: a money or people operation would run with
   * no confirmation at all.
   *
   * That is why Phase 3's propose-gate lives in the agent rather than the
   * spine. And it is why the gate must mirror BOTH conditions — checking
   * `involvesMoneyOrPeople` alone would let every `category: "people"`
   * operation straight through.
   */
});
