import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import type { OperationCategory } from "@/spine/operation/registry";

/**
 * Every operation's safety declaration, pinned.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * Two fields decide whether an operation stops and asks under delegated
 * authority, and **both** of them are conditions in `gate.ts`:
 *
 *   :94   if (handler.involvesMoneyOrPeople(operation.args) && delegated)
 *   :99   if (delegated && category && this.autonomy.neverGraduates(category))
 *
 * with `NEVER_GRADUATE = {money, people, leaving-org}`.
 *
 * Neither is inferred. A new operation gets `involvesMoneyOrPeople: () => false`
 * and no category unless somebody decides otherwise, and a default is exactly
 * what a safety declaration must not have. **This test is the forcing function:
 * adding an operation fails it until the author writes the answer down here.**
 *
 * Phase 3 hands all 59 to a model. From that point a wrong declaration is not a
 * dormant inconsistency — it is an operation acting on somebody else's record
 * without stopping to ask.
 *
 * ── ⚠ What the Phase 3 plan gets wrong, and this file records ───────────────
 *
 * The plan's precondition says: *"`category` does not appear in any parking
 * condition… setting it does NOT make an operation park."* It quotes `:94` and
 * stops four lines short of `:99`. `course.assign`, `employee.update` and
 * `employee.updateContact` are named there as an open hole; all three **do**
 * park under delegation, via category. `parking-audit.test.ts` proves it.
 *
 * The hole Phase 3 does have to close is different and larger: **both branches
 * require `delegated`**, and an agent submits `start: "typed"`, which is not
 * delegated. So its propose-gate must mirror **both** conditions —
 * `involvesMoneyOrPeople` alone would let every `category: "people"` operation
 * straight through.
 */

/** `gate.ts:99`'s set, restated so a change there fails a test here. */
const NEVER_GRADUATE: ReadonlySet<string> = new Set(["money", "people", "leaving-org"]);

interface Declaration {
  money: boolean;
  category?: OperationCategory;
}

/**
 * The two parking conditions, together.
 *
 * This is the predicate Phase 3's propose-gate has to use. Checking one field
 * is how an operation that already parks for a standing rule sails past the
 * agent.
 */
function wouldParkIfDelegated(d: Declaration): boolean {
  return d.money || (d.category !== undefined && NEVER_GRADUATE.has(d.category));
}

/**
 * Every operation, with the declaration it makes.
 *
 * `money` is `involvesMoneyOrPeople({})`. Read out of the registry on
 * 2026-08-25 and audited one line at a time; the reasoning for each verdict is
 * in `phases/phase 3/outcome.md`.
 */
const DECLARED: Record<string, Declaration> = {
  // ── money and people: they stop and ask ──────────────────────────────────
  "employee.create": { money: true, category: "people" },
  "employee.deactivate": { money: true, category: "leaving-org" },
  "employee.reactivate": { money: true, category: "people" },
  "employee.setPay": { money: true, category: "money" },
  "expense.approve": { money: true, category: "people" },
  "expense.claim": { money: true, category: "people" },
  "expense.decline": { money: true, category: "people" },
  "joining.completeStep": { money: true, category: "people" },
  "joining.start": { money: true, category: "people" },
  "leave.approve": { money: true, category: "people" },
  "leave.decline": { money: true, category: "people" },
  "leave.request": { money: true, category: "people" },
  "leaving.applySeparation": { money: true, category: "leaving-org" },
  "leaving.completeHandover": { money: true, category: "people" },
  "leaving.start": { money: true, category: "people" },

  // ── flag false, but category parks them anyway ───────────────────────────
  // The Phase 3 plan lists the first three as an open hole. They are not: a
  // delegated run parks on the never-graduate branch. What IS true is that the
  // agent's propose-gate must cover this column too.
  "course.assign": { money: false, category: "people" },
  "employee.update": { money: false, category: "people" },
  "employee.updateContact": { money: false, category: "people" },
  // Audited and CORRECT as they stand: `execute` throws unless
  // `employeeId === ctx.actor`, so neither can touch anybody else at all.
  "attendance.checkIn": { money: false, category: "people" },
  "attendance.checkOut": { money: false, category: "people" },

  // ── neither: they act on records, not on people ──────────────────────────
  "calendar.addPeople": { money: false },
  "calendar.cancel": { money: false },
  "calendar.create": { money: false },
  "calendar.edit": { money: false },
  "calendar.removePeople": { money: false },
  "course.assignStageOwner": { money: false },
  "course.create": { money: false, category: "routine" },
  "course.delete": { money: false, category: "routine" },
  "course.restoreVersion": { money: false },
  "course.setModuleState": { money: false },
  "course.setProgressNote": { money: false },
  "course.updateStage": { money: false },
  "document.require": { money: false },
  "document.store": { money: false },
  "equipment.reportFault": { money: false },
  "event.addTask": { money: false },
  "event.close": { money: false },
  "event.create": { money: false },
  "event.register": { money: false },
  "meeting.addAttendee": { money: false },
  "meeting.cancel": { money: false },
  "meeting.completeAction": { money: false },
  "meeting.create": { money: false },
  "meeting.recordDecisions": { money: false },
  "meeting.update": { money: false },
  "notify.send": { money: false },
  "orgMemory.record": { money: false },
  "room.book": { money: false },
  "room.cancel": { money: false },
  "task.assign": { money: false },
  "task.complete": { money: false },
  "task.create": { money: false },
  "task.delete": { money: false },
  "task.edit": { money: false },
  "task.start": { money: false },
  "utility.capture": { money: false },

  // ── dynamic, and never tools ─────────────────────────────────────────────
  // `record.*` browses 162 raw N1 doctypes and was the source of the pay hole.
  // Standing decision: they do not become tools, in this phase or any other.
  "record.create": { money: false, category: "routine" },
  "record.delete": { money: false, category: "routine" },
  "record.update": { money: false, category: "routine" },
};

async function declarations(): Promise<Record<string, Declaration>> {
  const { registry } = await buildDemoWorld();
  const out: Record<string, Declaration> = {};
  for (const name of registry.list() as string[]) {
    const handler = registry.get(name) as
      | { involvesMoneyOrPeople?: (args: unknown) => boolean; category?: OperationCategory }
      | undefined;
    if (!handler) continue;
    let money = false;
    try {
      money = handler.involvesMoneyOrPeople?.({}) === true;
    } catch {
      // A handler that inspects its args to decide is still a declaration; an
      // empty-args probe just cannot see it. None does today, and the count
      // assertion below would catch one appearing.
      money = false;
    }
    out[name] = { money, ...(handler.category ? { category: handler.category } : {}) };
  }
  return out;
}

describe("every operation's safety declaration is deliberate", () => {
  it("declares exactly the operations that are registered — no more, no fewer", async () => {
    const actual = await declarations();
    // A new operation lands here as a failing name. That is the point: it
    // cannot inherit `false` quietly.
    expect(Object.keys(actual).sort()).toEqual(Object.keys(DECLARED).sort());
  });

  it("every declaration matches what the operation actually says", async () => {
    const actual = await declarations();
    const drifted: string[] = [];
    for (const [name, expected] of Object.entries(DECLARED)) {
      const got = actual[name];
      if (!got) continue;
      if (got.money !== expected.money || got.category !== expected.category) {
        drifted.push(
          `${name}: declared {money:${expected.money}, category:${expected.category ?? "-"}} ` +
            `but the handler says {money:${got.money}, category:${got.category ?? "-"}}`,
        );
      }
    }
    expect(
      drifted,
      `A safety declaration changed without this test changing:\n  ${drifted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the counts are what the phase plans were written against", async () => {
    const actual = await declarations();
    const all = Object.values(actual);
    expect(all).toHaveLength(59);
    expect(all.filter((d) => d.money)).toHaveLength(15);
    // 44 = 41 the plan audits, plus the three dynamic `record.*`.
    expect(all.filter((d) => !d.money)).toHaveLength(44);
  });

  it("names what would park under DELEGATED authority — both branches, not one", async () => {
    const actual = await declarations();
    const parks = Object.entries(actual)
      .filter(([, d]) => wouldParkIfDelegated(d))
      .map(([n]) => n)
      .sort();

    // 15 money/people + the five `category: "people"` ones whose flag is false.
    expect(parks).toHaveLength(20);
    for (const name of [
      "course.assign",
      "employee.update",
      "employee.updateContact",
      "attendance.checkIn",
      "attendance.checkOut",
    ]) {
      expect(parks, `${name} parks via category, not via the flag`).toContain(name);
    }

    // The number that matters for Phase 3: checking the flag alone misses five.
    const flagOnly = Object.entries(actual).filter(([, d]) => d.money).length;
    expect(parks.length - flagOnly).toBe(5);
  });
});
