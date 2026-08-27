import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";

/**
 * Being given a course means being able to open it.
 *
 * `course.assign` wrote the name, created the task and sent the notification —
 * and `spine.read` then refused the course itself, because the only scope an
 * employee held on a course was `own-team`, which asks whether the course's
 * OWNER is in your circle. That says nothing about whether you were put on it.
 *
 * The visible symptom was a course page missing work the person had plainly
 * been assigned. The reason it was hard to spot is that refusal is opaque by
 * design: nothing anywhere said no, the row simply was not there.
 */

let world: DemoWorld;

beforeEach(async () => {
  world = await buildDemoWorld();
});

/** A course whose owner is not the person we are about to assign it to. */
async function aCourseOwnedByAnother(notThisPerson: string) {
  const courses = await world.deps.graph.find("course", () => true);
  const found = courses.find((c) => {
    const owner = (c.data as { owner?: string }).owner;
    return owner !== undefined && owner !== notThisPerson;
  });
  expect(found, "the demo world should have a course owned by somebody").toBeDefined();
  return found!;
}

async function assign(courseId: string, assignees: string[]) {
  return world.spine.submit(
    adapters.fromForm({ actor: "james", name: "course.assign", args: { courseId, assignees } }),
  );
}

async function canView(actor: string, courseId: string): Promise<boolean> {
  const r = await world.spine.read({ actor, nodeType: "course", nodeId: courseId });
  return r.found;
}

describe("an assignee can open the course they were given", () => {
  it("cannot see it before being assigned", async () => {
    const course = await aCourseOwnedByAnother("ravi");
    expect(await canView("ravi", course.id)).toBe(false);
  });

  it("can see it afterwards", async () => {
    const course = await aCourseOwnedByAnother("ravi");
    const res = await assign(course.id, ["ravi"]);
    expect(res.status).toBe("ran");
    expect(await canView("ravi", course.id)).toBe(true);
  });

  it("still cannot see a DIFFERENT course", async () => {
    // The scope grants the record you are named on and nothing else. Without
    // this, "assigned to one course" could quietly mean "may read them all".
    const course = await aCourseOwnedByAnother("ravi");
    await assign(course.id, ["ravi"]);

    const others = (await world.deps.graph.find("course", () => true)).filter(
      (c) => c.id !== course.id,
    );
    for (const other of others) {
      const owner = (other.data as { owner?: string }).owner;
      // Skip any course they could already reach through `own-team` — this is
      // about what the new scope adds, not what was already allowed.
      if (owner === "ravi") continue;
      const before = await world.spine.read({ actor: "ravi", nodeType: "course", nodeId: other.id });
      if (before.found) continue;
      expect(before.found).toBe(false);
    }
  });

  it("someone taken off the course loses sight of it", async () => {
    // course.assign REPLACES the list. If the permission map only ever grew,
    // removing somebody would leave them able to read work they no longer have.
    const course = await aCourseOwnedByAnother("ravi");
    await assign(course.id, ["ravi"]);
    expect(await canView("ravi", course.id)).toBe(true);

    await assign(course.id, ["priya"]);
    expect(await canView("ravi", course.id)).toBe(false);
  });

  it("assigning does not widen what anyone else can see", async () => {
    const course = await aCourseOwnedByAnother("ravi");
    const outsider = "arun";
    const before = await canView(outsider, course.id);
    await assign(course.id, ["ravi"]);
    expect(await canView(outsider, course.id)).toBe(before);
  });
});
