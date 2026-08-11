import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "./bootstrap";
import * as adapters from "@/spine/adapters";
import { isRestricted } from "@/spine/permission/types";

function world() {
  return buildDemoWorld();
}

describe("gate — run path", () => {
  it("runs a course stage update for a course-lead (own hand)", async () => {
    const { spine } = await world();
    const op = adapters.fromForm({
      actor: "james",
      name: "course.updateStage",
      args: { courseId: "ai-presentations", stage: "published" },
    });
    const res = await spine.submit(op);
    expect(res.status).toBe("ran");
    expect(res.activityEntry?.changes[0]?.after).toMatchObject({
      stage: "published",
    });
  });
});

describe("gate — refusal does not disclose existence (non-negotiable #2)", () => {
  it("returns an opaque forbidden with no record-existence hint", async () => {
    const { spine } = await world();
    const op = adapters.fromForm({
      actor: "ravi",
      name: "course.updateStage",
      args: { courseId: "ai-presentations", stage: "draft" },
    });
    const res = await spine.submit(op);
    expect(res.status).toBe("forbidden");
    expect(res.opaqueMessage).toBeTruthy();
    expect(JSON.stringify(res)).not.toContain("ai-presentations");
  });

  it("forbidden looks identical whether or not the record exists", async () => {
    const { spine } = await world();
    const existing = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "course.updateStage",
        args: { courseId: "ai-presentations", stage: "draft" },
      }),
    );
    const nonexistent = await spine.submit(
      adapters.fromForm({
        actor: "ravi",
        name: "course.updateStage",
        args: { courseId: "does-not-exist", stage: "draft" },
      }),
    );
    expect(existing.status).toBe("forbidden");
    expect(nonexistent.status).toBe("forbidden");
  });
});

describe("gate — money/people always ask (non-negotiable #3)", () => {
  it("runs when a person requests their own leave (own hand)", async () => {
    const { spine } = await world();
    const op = adapters.fromTyped({
      actor: "priya",
      name: "leave.request",
      args: { employeeId: "priya", fromDate: "2026-08-08", toDate: "2026-08-08" },
    });
    const res = await spine.submit(op);
    expect(res.status).toBe("ran");
  });

  it("forces confirmation when a standing rule tries a people action", async () => {
    const { spine } = await world();
    const op = adapters.fromStandingRule({
      ruleId: "auto-leave",
      ruleAuthor: "james",
      name: "leave.request",
      args: { employeeId: "priya", fromDate: "2026-08-08", toDate: "2026-08-08" },
    });
    const res = await spine.submit(op);
    expect(res.status).toBe("awaiting-confirmation");
    expect(res.reason).toBe("money-or-people");
    expect(res.pendingId).toBeTruthy();
  });

  it("runs only after a person confirms the money/people action", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromStandingRule({
        ruleId: "auto-leave",
        ruleAuthor: "james",
        name: "leave.request",
        args: { employeeId: "priya", fromDate: "2026-08-08", toDate: "2026-08-08" },
      }),
    );
    expect(res.status).toBe("awaiting-confirmation");
    const confirmed = await spine.confirm(res.pendingId!, "james");
    expect(confirmed.status).toBe("ran");
    expect(confirmed.activityEntry?.approvedBy).toBe("james");
    expect(confirmed.activityEntry?.confirmationReason).toBe("money-or-people");
  });
});

describe("gate — autonomy is earned, never assumed (appendix B)", () => {
  it("holds a supervised standing-rule action until approved", async () => {
    const { spine } = await world();
    const op = adapters.fromStandingRule({
      ruleId: "overdue-list",
      ruleAuthor: "james",
      name: "announcement.send",
      args: { message: "Courses overdue", to: ["james"] },
    });
    const res = await spine.submit(op);
    expect(res.status).toBe("awaiting-confirmation");
    expect(res.reason).toBe("not-earned");
    const confirmed = await spine.confirm(res.pendingId!, "james");
    expect(confirmed.status).toBe("ran");
  });
});

describe("gate — validation tells you exactly what is missing", () => {
  it("lists missing arguments (this is not a permission refusal)", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "course.updateStage",
        args: { stage: "draft" } as Record<string, unknown>,
      }),
    );
    expect(res.status).toBe("rejected");
    expect(res.missing).toEqual(["courseId"]);
  });
});

describe("field permission — pay is restricted, never silently missing (appendix C)", () => {
  it("shows pay as a Restricted marker to a course-writer", async () => {
    const { spine } = await world();
    const read = await spine.read({
      actor: "arun",
      nodeType: "employee",
      nodeId: "priya",
    });
    expect(read.found).toBe(true);
    if (read.found) {
      expect(isRestricted(read.record.pay)).toBe(true);
      expect(read.record.name).toBe("Priya R.");
      expect(read.record.contact).toBeTruthy();
    }
  });

  it("shows pay in full to hr (role permits it)", async () => {
    const { spine } = await world();
    const read = await spine.read({
      actor: "shruti",
      nodeType: "employee",
      nodeId: "priya",
    });
    expect(read.found).toBe(true);
    if (read.found) {
      expect(isRestricted(read.record.pay)).toBe(false);
      expect(typeof read.record.pay).toBe("number");
    }
  });

  it("export is not the same as view (non-negotiable #10)", async () => {
    const { spine } = await world();
    expect(spine.canExport("arun", "employee")).toBe(false);
    expect(spine.canExport("shruti", "employee")).toBe(true);
  });
});

describe("activity log + undo (feature 05)", () => {
  it("records who/authority/changes and supports undo", async () => {
    const { spine, deps } = await world();
    const before = (await deps.graph.getNode("course", "ai-presentations"))?.data;
    expect((before as { stage: string }).stage).toBe("review");
    const res = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "course.updateStage",
        args: { courseId: "ai-presentations", stage: "published" },
      }),
    );
    expect(res.status).toBe("ran");
    const entryId = res.activityEntry!.id;
    const after = (await deps.graph.getNode("course", "ai-presentations"))?.data;
    expect((after as { stage: string }).stage).toBe("published");

    const undone = await spine.undo(entryId, "james");
    expect(undone.status).toBe("undone");
    const restored = (await deps.graph.getNode("course", "ai-presentations"))?.data;
    expect((restored as { stage: string }).stage).toBe("review");
    const original = await deps.log.get(entryId);
    expect(original?.outcome).toBe("undone");
  });
});

describe("figures you can question (feature 06)", () => {
  it("opens a figure into the parts it was computed from", async () => {
    const { deps } = await world();
    const figs = await deps.figures.forRecord("course", "ai-presentations");
    expect(figs.length).toBeGreaterThan(0);
    const completion = figs.find((f) => f.label === "Course completion")!;
    expect(completion.value).toBe(60);
    const breakdown = (await deps.figures.breakdown(completion.id))!;
    expect(breakdown.parts.find((p) => p.label === "Modules finished")?.value).toBe(3);
    expect(breakdown.parts.find((p) => p.label === "Modules not started")?.value).toBe(1);
    expect(completion.explainer).toContain("3 of 5");
  });
});

describe("connected record — cross-record query (feature 02)", () => {
  it("answers which courses Priya wrote in one query", async () => {
    const { deps } = await world();
    const result = await deps.graph.traverse({
      start: "priya",
      steps: [{ edgeType: "writes", direction: "out", toNodeType: "course" }],
    });
    const titles = result.map((n) => n.data.title);
    expect(titles).toEqual(
      expect.arrayContaining(["AI for Presentations", "AI for Data Analysis"]),
    );
  });
});

describe("seven-start adapters all emit one Operation", () => {
  it("each of the seven produces a valid operation shape", () => {
    const cases = [
      adapters.fromForm({ actor: "james", name: "x", args: {} }),
      adapters.fromTyped({ actor: "james", name: "x", args: {} }),
      adapters.fromVoice({
        actor: "james",
        name: "x",
        args: {},
        transcript: "do x",
      }),
      adapters.fromSchedule({
        scheduleId: "s1",
        ruleId: "r1",
        ruleAuthor: "james",
        name: "x",
        args: {},
      }),
      adapters.fromRecordChange({
        nodeType: "course",
        nodeId: "c1",
        ruleId: "r1",
        ruleAuthor: "james",
        name: "x",
        args: {},
      }),
      adapters.fromStandingRule({
        ruleId: "r1",
        ruleAuthor: "james",
        name: "x",
        args: {},
      }),
      adapters.fromRoutine({
        ruleId: "r1",
        ruleAuthor: "james",
        name: "x",
        args: {},
      }),
    ];
    for (const op of cases) {
      expect(op.name).toBe("x");
      expect(op.id).toBeTruthy();
      expect(op.runsUnder).toBeTruthy();
      expect(op.authority).toBeTruthy();
    }
    expect(cases.map((c) => c.startedBy.kind)).toEqual([
      "form",
      "typed",
      "voice",
      "schedule",
      "record-change",
      "standing-rule",
      "routine",
    ]);
  });
});
