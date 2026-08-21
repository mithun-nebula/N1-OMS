import { describe, it, expect } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";

function world() {
  return buildDemoWorld();
}

async function submitClaim(
  spine: DemoWorld["spine"],
  employeeId: string,
  overrides: Partial<{
    amount: number;
    category: string;
    description: string;
    date: string;
  }> = {},
) {
  return spine.submit(
    adapters.fromForm({
      actor: employeeId,
      name: "expense.claim",
      args: {
        employeeId,
        amount: 4200,
        category: "Travel",
        description: "Client visit",
        date: "2026-08-14",
        ...overrides,
      },
    }),
  );
}

type ClaimResponse = { claimId: string; approver?: string };

function claimResponse(res: { result?: { response?: unknown } }): ClaimResponse {
  return res.result?.response as ClaimResponse;
}

describe("expense.claim — creates a Pending claim + resolves approver", () => {
  it("creates a Pending expense-claim node with the seeded field shape", async () => {
    const { spine, deps } = await world();
    const res = await submitClaim(spine, "priya");
    expect(res.status).toBe("ran");
    const { claimId, approver } = claimResponse(res);
    expect(claimId).toBeTruthy();
    const node = await deps.graph.getNode("expense-claim", claimId);
    expect(node?.data).toMatchObject({
      employee: "priya",
      expenseDate: "2026-08-14",
      totalAmount: 4200,
      category: "Travel",
      description: "Client visit",
      status: "Pending",
    });
    expect(approver).toBe("james");
  });

  it("registers the owner so the fresh claim is visible to its owner without a restart", async () => {
    const { spine } = await world();
    const res = await submitClaim(spine, "priya");
    const claimId = claimResponse(res).claimId;
    const own = await spine.read({ actor: "priya", nodeType: "expense-claim", nodeId: claimId });
    expect(own.found).toBe(true);
  });

  it("rejects a zero or negative amount", async () => {
    const { spine } = await world();
    const zero = await submitClaim(spine, "priya", { amount: 0 });
    expect(zero.status).toBe("rejected");
    const negative = await submitClaim(spine, "priya", { amount: -50 });
    expect(negative.status).toBe("rejected");
  });

  it("rejects missing fields", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "expense.claim",
        args: { employeeId: "priya", amount: 100 },
      }),
    );
    expect(res.status).toBe("rejected");
  });

  it("cannot be filed on somebody else's behalf", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "expense.claim",
        args: {
          employeeId: "priya",
          amount: 100,
          category: "Food",
          description: "Not mine",
          date: "2026-08-14",
        },
      }),
    );
    expect(res.status).toBe("forbidden");
  });
});

describe("expense.approve / expense.decline — recorded, undoable, gated", () => {
  it("a manager approves a team member's claim (recorded + undoable)", async () => {
    const { spine, deps } = await world();
    const req = await submitClaim(spine, "priya");
    const claimId = claimResponse(req).claimId;

    const approve = await spine.submit(
      adapters.fromForm({ actor: "james", name: "expense.approve", args: { claimId } }),
    );
    expect(approve.status).toBe("ran");
    expect(approve.activityEntry?.changes[0]?.after).toMatchObject({
      status: "Approved",
      approvedBy: "james",
    });
    expect((await deps.graph.getNode("expense-claim", claimId))?.data.status).toBe("Approved");

    const undone = await spine.undo(approve.activityEntry!.id, "james");
    expect(undone.status).toBe("undone");
    expect((await deps.graph.getNode("expense-claim", claimId))?.data.status).toBe("Pending");
  });

  it("declining requires a reason", async () => {
    const { spine } = await world();
    const req = await submitClaim(spine, "priya");
    const claimId = claimResponse(req).claimId;
    const noReason = await spine.submit(
      adapters.fromForm({ actor: "james", name: "expense.decline", args: { claimId } }),
    );
    expect(noReason.status).toBe("rejected");
  });

  it("a manager declines with a reason (recorded + undoable)", async () => {
    const { spine, deps } = await world();
    const req = await submitClaim(spine, "priya");
    const claimId = claimResponse(req).claimId;

    const decline = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "expense.decline",
        args: { claimId, reason: "No receipt attached." },
      }),
    );
    expect(decline.status).toBe("ran");
    const node = await deps.graph.getNode("expense-claim", claimId);
    expect(node?.data.status).toBe("Declined");
    expect(node?.data.reason).toContain("No receipt");

    const undone = await spine.undo(decline.activityEntry!.id, "james");
    expect(undone.status).toBe("undone");
    expect((await deps.graph.getNode("expense-claim", claimId))?.data.status).toBe("Pending");
  });

  it("priya cannot approve her own claim, james (her manager) can", async () => {
    // The manager approve rule is `team-others` scope: approving is always
    // about somebody else. Priya holds no approve rule at all; james's
    // team-others scope covers her but not himself.
    const { spine } = await world();
    const req = await submitClaim(spine, "priya");
    const claimId = claimResponse(req).claimId;

    const own = await spine.submit(
      adapters.fromForm({ actor: "priya", name: "expense.approve", args: { claimId } }),
    );
    expect(own.status).toBe("forbidden");

    const manager = await spine.submit(
      adapters.fromForm({ actor: "james", name: "expense.approve", args: { claimId } }),
    );
    expect(manager.status).toBe("ran");
  });

  it("a manager cannot approve their own claim either", async () => {
    // A manager has no `edit self` rule on employee (mirroring leave, where a
    // manager's own request also routes elsewhere), so the claim is filed by
    // HR on james's behalf. His approve rule is `team-others` — approving is
    // always about somebody else — so his own claim stays out of reach, while
    // HR (scope `all`) can settle it.
    const { spine } = await world();
    const req = await spine.submit(
      adapters.fromForm({
        actor: "shruti",
        name: "expense.claim",
        args: {
          employeeId: "james",
          amount: 900,
          category: "Food",
          description: "Team dinner",
          date: "2026-08-15",
        },
      }),
    );
    expect(req.status).toBe("ran");
    const claimId = claimResponse(req).claimId;

    const own = await spine.submit(
      adapters.fromForm({ actor: "james", name: "expense.approve", args: { claimId } }),
    );
    expect(own.status).toBe("forbidden");

    const hr = await spine.submit(
      adapters.fromForm({ actor: "shruti", name: "expense.approve", args: { claimId } }),
    );
    expect(hr.status).toBe("ran");
  });

  it("an intern from another team cannot approve (forbidden, opaque)", async () => {
    const { spine } = await world();
    const req = await submitClaim(spine, "priya");
    const claimId = claimResponse(req).claimId;
    const res = await spine.submit(
      adapters.fromForm({ actor: "ravi", name: "expense.approve", args: { claimId } }),
    );
    expect(res.status).toBe("forbidden");
  });
});
