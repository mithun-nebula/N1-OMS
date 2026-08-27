import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import { resolvePerson } from "./resolve-person";
import { workWriteTools } from "./work";

/**
 * A named person reaches the operation, or nothing happens.
 *
 * `create_task` asked for an "Employee id" and said to omit it if unsure. A
 * model told *"create a task for Arun"* holds no id, so it omitted the field —
 * and the task arrived on the board UNASSIGNED. The task existed, the person
 * never got it, and nothing anywhere said why. The silence is the defect.
 */

beforeEach(async () => {
  await buildDemoWorld();
});

describe("a name becomes an id", () => {
  it("passes an id straight through", () => {
    expect(resolvePerson("priya")).toEqual({ kind: "one", id: "priya" });
  });

  it("resolves a first name", () => {
    const r = resolvePerson("Priya");
    expect(r.kind).toBe("one");
  });

  it("is not case-sensitive", () => {
    expect(resolvePerson("PRIYA").kind).toBe("one");
  });

  it("says so when there is nobody by that name", () => {
    // Not silence, and not a guess — the two failures that hid this bug.
    expect(resolvePerson("Nobody McNobody")).toEqual({ kind: "none" });
  });
});

describe("the tools that take a person declare it", () => {
  const withPeople = workWriteTools.filter((t) => (t.people ?? []).length > 0);

  it("covers create_task and assign_task", () => {
    const names = withPeople.map((t) => t.tool);
    expect(names).toContain("create_task");
    expect(names).toContain("assign_task");
  });

  it("every declared field actually exists on that tool's arguments", () => {
    // A field named here but absent from the schema would resolve nothing and
    // fail silently — the same shape as the bug this fixes.
    for (const t of withPeople) {
      const shape = t.args.shape as Record<string, unknown>;
      for (const field of t.people ?? []) {
        expect(Object.keys(shape), `${t.tool}.${field}`).toContain(field);
      }
    }
  });

  it("create_task tells the model a name is acceptable", () => {
    const create = workWriteTools.find((t) => t.tool === "create_task")!;
    const notes = (create.notes ?? []).join(" ").toLowerCase();
    expect(notes).toContain("name");
    // The old note said "Employee id" and nothing else, which is what made the
    // model leave the field out rather than ask.
    expect(notes).not.toMatch(/^leave assignedto out/);
  });
});
