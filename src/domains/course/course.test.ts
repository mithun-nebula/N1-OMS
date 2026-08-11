import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { CourseService } from "./service";
import { findStaleCourses, readVersions } from "./versioning";

function world() {
  return buildDemoWorld();
}

describe("course.updateStage — state machine", () => {
  it("allows a valid forward transition (outline → draft)", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "course.updateStage",
        args: { courseId: "spreadsheet-automation", stage: "draft" },
      }),
    );
    expect(res.status).toBe("ran");
  });

  it("allows rework (review → draft)", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "course.updateStage",
        args: { courseId: "ai-presentations", stage: "draft" },
      }),
    );
    expect(res.status).toBe("ran");
  });

  it("rejects an invalid transition (outline → published) with a reason", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "course.updateStage",
        args: { courseId: "spreadsheet-automation", stage: "published" },
      }),
    );
    expect(res.status).toBe("rejected");
    expect(res.detail).toMatch(/outline.*published|published.*outline/);
  });
});

describe("course.setModuleState — progress derived from the work itself", () => {
  it("updates a module and recomputes the completion figure", async () => {
    const { spine, deps } = await world();
    const before = (await deps.figures.forRecord("course", "ai-data-analysis", "Course completion"))[0];
    expect(before?.value).toBe(33);
    const res = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "course.setModuleState",
        args: { courseId: "ai-data-analysis", moduleIndex: 2, state: "published" },
      }),
    );
    expect(res.status).toBe("ran");
    const after = (await deps.figures.forRecord("course", "ai-data-analysis", "Course completion"))[0];
    expect(after?.value).toBe(67);
    expect((res.result?.response as { completion?: number }).completion).toBe(67);
  });
});

describe("course.setProgressNote + assignStageOwner", () => {
  it("stores a free-text progress note", async () => {
    const { spine, deps } = await world();
    const res = await spine.submit(
      adapters.fromTyped({
        actor: "priya",
        name: "course.setProgressNote",
        args: { courseId: "ai-data-analysis", note: "almost done, just tasks left" },
      }),
    );
    expect(res.status).toBe("ran");
    expect(
      ((await deps.graph.getNode("course", "ai-data-analysis"))?.data as { progressNote?: { text?: string } }).progressNote?.text,
    ).toContain("almost done");
  });

  it("names a stage owner (reviewer)", async () => {
    const { spine, deps } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "course.assignStageOwner",
        args: { courseId: "ai-presentations", stage: "review", owner: "meena" },
      }),
    );
    expect(res.status).toBe("ran");
    const stageOwners = ((await deps.graph.getNode("course", "ai-presentations"))?.data as { stageOwners?: Record<string, string> }).stageOwners;
    expect(stageOwners?.review).toBe("meena");
  });
});

describe("course version history — append-only, restorable", () => {
  it("snapshots on stage + module change and restores a prior version", async () => {
    const { spine, deps } = await world();
    await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "course.updateStage",
        args: { courseId: "ai-data-analysis", stage: "review" },
      }),
    );
    await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "course.setModuleState",
        args: { courseId: "ai-data-analysis", moduleIndex: 0, state: "not-started" },
      }),
    );
    const versions = await readVersions(deps.graph, "ai-data-analysis");
    expect(versions.length).toBeGreaterThanOrEqual(2);

    const restore = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "course.restoreVersion",
        args: { courseId: "ai-data-analysis", version: 1 },
      }),
    );
    expect(restore.status).toBe("ran");
    const restoredStage = ((await deps.graph.getNode("course", "ai-data-analysis"))?.data as { stage?: string }).stage;
    expect(restoredStage).toBe("review");
  });

  it("an employee cannot restore a version (approve-only)", async () => {
    const { spine } = await world();
    const res = await spine.submit(
      adapters.fromForm({
        actor: "arun",
        name: "course.restoreVersion",
        args: { courseId: "ai-data-analysis", version: 1 },
      }),
    );
    expect(res.status).toBe("forbidden");
  });
});

describe("findStaleCourses — 'waiting 8 days' detector", () => {
  it("flags ai-presentations (in review past the threshold)", async () => {
    const { deps } = await world();
    const stale = await findStaleCourses(deps.graph, "2026-08-07");
    const ids = stale.map((s) => s.courseId);
    expect(ids).toContain("ai-presentations");
    const flagged = stale.find((s) => s.courseId === "ai-presentations");
    expect(flagged?.daysWaiting).toBeGreaterThan(8);
    expect(ids).not.toContain("ai-basics");
  });
});

describe("CourseService — team-progress aggregate + deck", () => {
  it("lists every course with completion + stale flag", async () => {
    const { deps } = await world();
    const service = new CourseService(deps.graph, deps.figures);
    const progress = await service.listProgress("2026-08-07");
    expect(progress.length).toBe(4);
    const aiPres = progress.find((p) => p.id === "ai-presentations");
    expect(aiPres?.stale).toBe(true);
    expect(aiPres?.completion?.value).toBe(60);
  });

  it("generates a deck outline (heuristic fallback when no LLM)", async () => {
    const { deps } = await world();
    const service = new CourseService(deps.graph, deps.figures);
    const deck = await service.generateDeck({ courseId: "ai-basics" });
    expect(deck.slides.length).toBeGreaterThan(0);
    expect(deck.topic).toBe("AI Basics");
    expect(["heuristic", "llm"]).toContain(deck.source);
  });
});
