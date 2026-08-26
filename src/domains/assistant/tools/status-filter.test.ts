import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { CourseService } from "@/domains/course/service";
import { ToolContext, type ToolDeps } from "./context";
import { ALL_TOOLS } from "./index";

/**
 * Filtering by status must actually find things.
 *
 * ── The bug this pins ───────────────────────────────────────────────────────
 *
 * `list_leave` offers `status: "pending" | "approved" | "declined"` and the
 * records store `"Pending"`, `"Approved"`, `"Declined"`. Compared directly,
 * **`status: "pending"` matched nothing at all** — so *"whose leave needs my
 * approval"*, which is the single most common question an HR person asks this
 * product, answered "none" for everybody, always.
 *
 * It survived because every existing test called `list_leave` **without** a
 * status. Found by running Phase 3 for real against a seeded database, where
 * the model quite reasonably passed one.
 *
 * The shape of the mistake is what makes it worth a test rather than a fix: a
 * silent empty list reads as a true answer. Nothing errors, nothing is slow,
 * and the person is told there is no work waiting when there is.
 */

let world: DemoWorld;
let deps: ToolDeps;

beforeEach(async () => {
  world = await buildDemoWorld();
  deps = {
    spine: world.spine,
    graph: world.deps.graph,
    figures: world.deps.figures,
    permissions: world.deps.permissions,
    courses: new CourseService(world.deps.graph, world.deps.figures),
    today: () => "2026-08-08",
  };
});

async function call(actor: string, name: string, input: Record<string, unknown>) {
  const spec = ALL_TOOLS.find((t) => t.name === name)!;
  const built = spec.build(new ToolContext(actor, deps)) as {
    execute: (i: unknown, o: unknown) => Promise<unknown>;
  };
  return (await built.execute(input, { toolCallId: "t", messages: [] })) as {
    items?: Array<Record<string, unknown>>;
    total?: number;
  };
}

describe("a status filter finds the records it names", () => {
  it("list_leave: pending finds a pending request", async () => {
    const requested = await world.spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "leave.request",
        args: { employeeId: "priya", fromDate: "2027-07-01", toDate: "2027-07-03" },
      }),
    );
    expect(requested.status).toBe("ran");
    const leaveId = (requested.result?.response as { leaveId: string }).leaveId;

    const unfiltered = await call("shruti", "list_leave", {});
    expect(unfiltered.items?.some((r) => r.id === leaveId)).toBe(true);

    // The case that was broken. Same record, filtered by the value the schema
    // itself offers.
    const filtered = await call("shruti", "list_leave", { status: "pending" });
    expect(
      filtered.items?.some((r) => r.id === leaveId),
      'list_leave({status:"pending"}) found nothing — the stored status is "Pending"',
    ).toBe(true);
  });

  it("list_leave: approved does not return a pending one", async () => {
    await world.spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "leave.request",
        args: { employeeId: "priya", fromDate: "2027-08-01", toDate: "2027-08-02" },
      }),
    );
    const approved = await call("shruti", "list_leave", { status: "approved" });
    // The filter has to still filter — a case-insensitive compare that matched
    // everything would pass the test above and be just as wrong.
    expect(approved.items?.length ?? 0).toBe(0);
  });

  it("list_expenses: pending finds a pending claim", async () => {
    const claimed = await world.spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "expense.claim",
        args: {
          employeeId: "priya",
          amount: 100,
          category: "travel",
          description: "taxi",
          date: "2027-07-01",
        },
      }),
    );
    expect(claimed.status).toBe("ran");
    const claimId = (claimed.result?.response as { claimId: string }).claimId;

    const filtered = await call("shruti", "list_expenses", { status: "pending" });
    expect(filtered.items?.some((r) => r.id === claimId)).toBe(true);
    const wrong = await call("shruti", "list_expenses", { status: "declined" });
    expect(wrong.items?.some((r) => r.id === claimId)).toBe(false);
  });
});
