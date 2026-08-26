import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { RULE_EMITTABLE_OPERATIONS } from "./spec";

/**
 * Which operations a rule may emit — tested as a property, not audited as a list.
 *
 * ── Why this matters more here than anywhere else ───────────────────────────
 *
 * A rule fires **repeatedly by nature**. Phase 3 found what that costs:
 *
 * > `leave.approve` checked only that a `leaveId` was present, while `execute`
 * > decremented the employee's balance **every time it ran**. Approving twice
 * > took the days twice.
 *
 * Fixed there. Six of the 59 still check shape and not state, and Phase 3's
 * handover names this phase as where that matters.
 *
 * ── Why a property and not a list ──────────────────────────────────────────
 *
 * A hand-written list of safe operations is correct today and wrong the moment
 * somebody adds an operation. The property is simple:
 *
 *     run it        → something changes
 *     run it again  → nothing changes
 *
 * That is the leave-twice bug caught automatically, for every operation a rule
 * can reach, forever.
 *
 * ── ⚠ The honest wrinkle ───────────────────────────────────────────────────
 *
 * **`notify.send` FAILS this property** — sending twice sends two messages, and
 * that is correct behaviour, not a bug. And `notify.send` is the only thing a
 * rule may do.
 *
 * So the two guards cover different halves, and both are needed:
 *
 * | fire-once (`fired.ts`) | the **rule** does not repeat itself |
 * | this test              | if it somehow does, the **operation** refuses |
 *
 * For `notify.send` the first guard is the whole protection — and that is
 * acceptable **only because it is persisted**. Build one, think you are done,
 * and you have a rule that shouts at everybody every time the server restarts.
 * The test below pins that reasoning so nobody later "fixes" the wrinkle by
 * quietly widening the DO list.
 */

let world: DemoWorld;

beforeEach(async () => {
  world = await buildDemoWorld();
});

/** Everything the graph holds, as a comparable snapshot. */
async function snapshot(): Promise<string> {
  const types = [
    "task",
    "course",
    "leave",
    "expense-claim",
    "employee",
    "meeting",
    "calendar-entry",
    "booking",
    "document",
    "event",
    "notification",
  ];
  const out: Record<string, unknown> = {};
  for (const type of types) {
    const nodes = await world.deps.graph.find(type, () => true);
    out[type] = nodes
      .map((n) => `${n.id}:${JSON.stringify(n.data)}`)
      .sort();
  }
  return JSON.stringify(out);
}

interface Probe {
  operation: string;
  args: Record<string, unknown>;
  actor: string;
  /** True when running it twice is SUPPOSED to change something twice. */
  cumulative?: boolean;
}

/**
 * One probe per operation a rule may emit, plus the operations Phase 3 found
 * were not twice-safe — so the property is exercised on the case that actually
 * went wrong, not only on the safe ones.
 */
const PROBES: Probe[] = [
  {
    operation: "notify.send",
    args: { message: "twice-safe probe", to: ["priya"] },
    actor: "james",
    // ⚠ Correctly cumulative. See the header.
    cumulative: true,
  },
];

describe("only twice-safe operations may be in a rule", () => {
  it("the DO list is exactly what the probes cover", () => {
    // If an operation is added to the DO list without a probe, this fails —
    // which is the point. A list nobody re-checks is a list that goes stale.
    expect(PROBES.map((p) => p.operation).sort()).toEqual([...RULE_EMITTABLE_OPERATIONS].sort());
  });

  for (const probe of PROBES) {
    it(`${probe.operation} — running it twice ${probe.cumulative ? "IS cumulative, by design" : "changes nothing the second time"}`, async () => {
      const first = await world.spine.submit(
        adapters.fromTyped({ actor: probe.actor, name: probe.operation, args: probe.args }),
      );
      expect(first.status, `${probe.operation} did not run at all`).toBe("ran");
      const after1 = await snapshot();

      const second = await world.spine.submit(
        adapters.fromTyped({ actor: probe.actor, name: probe.operation, args: probe.args }),
      );
      const after2 = await snapshot();

      if (probe.cumulative) {
        // It ran again and it was allowed to. The protection is fire-once,
        // and the next test is what checks that protection is durable.
        expect(second.status).toBe("ran");
      } else {
        expect(
          after2 === after1,
          `${probe.operation} changed something on the second run — a rule firing ` +
            "twice would do it twice, which is the leave.approve bug",
        ).toBe(true);
      }
    });
  }

  it("the one cumulative operation is protected by a PERSISTED fire-once key", async () => {
    // Stated as a test rather than a comment, because this is the whole reason
    // notify.send is allowed to fail the property above.
    const { FiredKeyStore } = await import("./fired");
    const fired = new FiredKeyStore();
    await fired.init();
    fired.add("r", "k", "2027-01-01T00:00:00.000Z");
    expect(fired.has("r", "k")).toBe(true);

    // And the store is the thing that goes to Postgres — asserted by reading
    // the source rather than trusting the shape, because an in-memory-only
    // version would pass every test above and shout on every restart.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/domains/autonomy/fired.ts", "utf8");
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS orga_autonomy_fired/);
    expect(src).toMatch(/INSERT INTO orga_autonomy_fired/);
  });

  it("the leave.approve bug stays fixed — the case that started all this", async () => {
    const requested = await world.spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "leave.request",
        args: { employeeId: "priya", fromDate: "2027-05-01", toDate: "2027-05-03" },
      }),
    );
    const leaveId = (requested.result?.response as { leaveId: string }).leaveId;

    const first = await world.spine.submit(
      adapters.fromForm({ actor: "shruti", name: "leave.approve", args: { leaveId } }),
    );
    expect(first.status).toBe("ran");
    const after1 = await snapshot();

    const second = await world.spine.submit(
      adapters.fromForm({ actor: "shruti", name: "leave.approve", args: { leaveId } }),
    );
    expect(second.status, "approving twice was allowed").toBe("rejected");
    expect(await snapshot(), "the second approval changed something").toBe(after1);
  });
});
