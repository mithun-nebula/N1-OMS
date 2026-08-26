import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";

function world() {
  return buildDemoWorld();
}

describe("course.create — manager+ starts a course at outline", () => {
  it("creates the node with modules, owner and a completion figure", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "course.create",
        args: { title: "Prompt Writing", modules: ["Basics", "Practice"] },
      }),
    );
    expect(created.status).toBe("ran");
    const courseId = (created.result?.response as { courseId: string }).courseId;
    const data = (await deps.graph.getNode("course", courseId))?.data as {
      title: string;
      stage: string;
      owner: string;
      modules: Array<{ name: string; state: string }>;
    };
    expect(data).toMatchObject({ title: "Prompt Writing", stage: "outline", owner: "james" });
    expect(data.modules.map((m) => m.name)).toEqual(["Basics", "Practice"]);
    expect((await deps.figures.forRecord("course", courseId, "Course completion")).length).toBe(1);

    // Undo removes it again.
    expect((await spine.undo(created.activityEntry!.id, "james")).status).toBe("undone");
    expect(await deps.graph.getNode("course", courseId)).toBeUndefined();
  });
});

describe("course.assign — each assignee gets their own linked task", () => {
  async function createCourse(spine: Awaited<ReturnType<typeof world>>["spine"]) {
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "course.create", args: { title: "Team Course" } }),
    );
    return (created.result?.response as { courseId: string }).courseId;
  }

  it("two people together → two owned tasks, both undone as one unit", async () => {
    const { spine, deps } = await world();
    const courseId = await createCourse(spine);
    const assigned = await spine.submit(
      adapters.fromForm({ actor: "james", name: "course.assign", args: { courseId, assignees: ["priya", "arun"] } }),
    );
    expect(assigned.status).toBe("ran");
    const { taskIds } = assigned.result?.response as { taskIds: string[] };
    expect(taskIds).toHaveLength(2);

    const course = (await deps.graph.getNode("course", courseId))?.data as { assignees?: string[] };
    expect(course.assignees).toEqual(["priya", "arun"]);
    for (const [i, taskId] of taskIds.entries()) {
      const task = (await deps.graph.getNode("task", taskId))?.data as {
        title: string;
        assignedTo: string;
        courseId: string;
      };
      expect(task).toMatchObject({
        title: "Work on Team Course",
        assignedTo: ["priya", "arun"][i],
        courseId,
      });
    }

    // Each assignee can finish their own share (self-scoped ownership held).
    const done = await spine.submit(
      adapters.fromForm({ actor: "priya", name: "task.complete", args: { taskId: taskIds[0] } }),
    );
    expect(done.status).toBe("ran");

    // Undoing the assignment takes the tasks back and restores the course.
    expect((await spine.undo(assigned.activityEntry!.id, "james")).status).toBe("undone");
    expect(((await deps.graph.getNode("course", courseId))?.data as { assignees?: string[] }).assignees).toBeUndefined();
    for (const taskId of taskIds) {
      expect(await deps.graph.getNode("task", taskId)).toBeUndefined();
    }
  });

  it("caps at three people and rejects unknown ones", async () => {
    const { spine } = await world();
    const courseId = await createCourse(spine);
    const four = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "course.assign",
        args: { courseId, assignees: ["priya", "arun", "ravi", "meena"] },
      }),
    );
    expect(four.status).toBe("rejected");

    const ghost = await spine.submit(
      adapters.fromForm({ actor: "james", name: "course.assign", args: { courseId, assignees: ["nobody-real"] } }),
    );
    expect(ghost.status).toBe("rejected");
  });

  it("an employee cannot assign a course", async () => {
    const { spine } = await world();
    const courseId = await createCourse(spine);
    const attack = await spine.submit(
      adapters.fromForm({ actor: "priya", name: "course.assign", args: { courseId, assignees: ["arun"] } }),
    );
    expect(attack.status).toBe("forbidden");
  });
});

describe("course.assign — a standing rule can never hand work to people unattended", () => {
  it("parks a delegated assign for confirmation, and says why", async () => {
    const { spine } = await world();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "course.create", args: { title: "AI Basics" } }),
    );
    const courseId = (created.result?.response as { courseId: string }).courseId;

    const res = await spine.submit(
      adapters.fromStandingRule({
        ruleId: "r1",
        ruleAuthor: "james",
        name: "course.assign",
        args: { courseId, assignees: ["priya"] },
      }),
    );

    expect(res.status).toBe("awaiting-confirmation");
    // The reason, not just the status: an ungraduated rule parks as
    // "not-earned" anyway, so only "never-graduate" proves the category is
    // doing the work. A graduated rule would sail past "not-earned".
    expect(res.reason).toBe("never-graduate");
  });

  it("a person filling in the form still needs no second confirmation", async () => {
    const { spine } = await world();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "course.create", args: { title: "By Hand" } }),
    );
    const courseId = (created.result?.response as { courseId: string }).courseId;
    const byHand = await spine.submit(
      adapters.fromForm({ actor: "james", name: "course.assign", args: { courseId, assignees: ["priya"] } }),
    );
    expect(byHand.status).toBe("ran");
  });
});
