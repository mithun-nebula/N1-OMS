import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { CourseService } from "@/domains/course/service";
import { ToolContext, type ToolDeps } from "../tools/context";
import { myMemory } from "../tools/memory-read";
import { MemoryStore, type MemoryFact, type MemoryPersistence } from "./store";
import { visibleFacts } from "./visible";

/**
 * What the assistant remembers, and the four things that must stay true of it.
 *
 *   1. one person's facts are ABSENT for another, never refused
 *   2. a fact resting on a record resolves through `spine.read` AT READ TIME
 *   3. a retired fact is still in the table and never returned
 *   4. the actor is not addressable
 */

const TODAY = "2026-08-08";

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
    today: () => TODAY,
  };
});

function ctxFor(actor: string, store: MemoryStore): ToolContext {
  return new ToolContext(actor, { ...deps, memory: store });
}

async function run(actor: string, store: MemoryStore, input: Record<string, unknown> = {}) {
  const ctx = ctxFor(actor, store);
  const built = myMemory.build(ctx) as {
    execute: (i: unknown, o: unknown) => Promise<unknown>;
  };
  return (await built.execute(input, {})) as {
    found: boolean;
    note?: string;
    items: Array<{ area: string; said: string }>;
  };
}

describe("the store", () => {
  it("is unobtainable in a durable-but-unhydrated state", () => {
    // The two-step version of this was a real bug elsewhere in the codebase:
    // `buildDemoWorld` built the durable thing and never hydrated it. The
    // constructor is private; `create()` is the only door, and it hydrates.
    const src = readFileSync("src/domains/assistant/memory/store.ts", "utf8");
    expect(src).toContain("private constructor(");
    expect(src).toContain("static async create(");
  });

  it("keeps what was said, tagged by an existing domain", async () => {
    const store = await MemoryStore.create();
    await store.remember({ actor: "hr-004", domain: "day", text: "I prefer afternoon reviews" });
    const facts = await store.recall("hr-004", { today: TODAY });
    expect(facts.map((f) => f.text)).toEqual(["I prefer afternoon reviews"]);
    expect(facts[0].domain).toBe("day");
  });

  it("gives a specialist only its own domain", async () => {
    const store = await MemoryStore.create();
    await store.remember({ actor: "hr-004", domain: "day", text: "afternoon reviews" });
    await store.remember({ actor: "hr-004", domain: "tasks", text: "small tasks first" });
    expect((await store.recall("hr-004", { domain: "tasks", today: TODAY })).map((f) => f.text)).toEqual([
      "small tasks first",
    ]);
  });

  it("⚠ retires, never deletes", async () => {
    const store = await MemoryStore.create();
    const fact = await store.remember({ actor: "hr-004", domain: "day", text: "morning reviews" });
    await store.retire("hr-004", fact.id);

    // Gone from what the assistant knows...
    expect(await store.recall("hr-004", { today: TODAY })).toEqual([]);
    // ...and still on the record. Feature 05: everything is recorded.
    expect((await store.allFor("hr-004")).map((f) => f.text)).toEqual(["morning reviews"]);
    expect((await store.allFor("hr-004"))[0].retiredAt).toBeDefined();
  });

  it("a correction supersedes rather than overwrites", async () => {
    const store = await MemoryStore.create();
    const first = await store.remember({ actor: "hr-004", domain: "day", text: "morning reviews" });
    await store.remember({
      actor: "hr-004",
      domain: "day",
      text: "afternoon reviews",
      supersedes: first.id,
    });
    expect((await store.recall("hr-004", { today: TODAY })).map((f) => f.text)).toEqual([
      "afternoon reviews",
    ]);
    // Both rows survive — what they used to prefer is history, not a deletion.
    expect(await store.allFor("hr-004")).toHaveLength(2);
  });

  it("an expired fact stops being known, on the day after it expires", async () => {
    const store = await MemoryStore.create();
    await store.remember({
      actor: "hr-004",
      domain: "day",
      text: "no meetings while I am on cover",
      expiresAt: TODAY,
    });
    // Inclusive: still true today.
    expect(await store.recall("hr-004", { today: TODAY })).toHaveLength(1);
    expect(await store.recall("hr-004", { today: "2026-08-09" })).toHaveLength(0);
  });

  it("somebody else's id retires nothing", async () => {
    const store = await MemoryStore.create();
    const fact = await store.remember({ actor: "hr-004", domain: "day", text: "afternoon reviews" });
    expect(await store.retire("hr-005", fact.id)).toBeUndefined();
    expect(await store.recall("hr-004", { today: TODAY })).toHaveLength(1);
  });
});

describe("⚠ one person's memory is ABSENT for another, not refused", () => {
  it("returns nothing, and says nothing about there being anything", async () => {
    const store = await MemoryStore.create();
    await store.remember({ actor: "hr-004", domain: "day", text: "afternoon reviews" });

    const mine = await run("hr-004", store);
    expect(mine.found).toBe(true);
    expect(mine.items.map((i) => i.said)).toEqual(["afternoon reviews"]);

    const theirs = await run("hr-005", store);
    expect(theirs.found).toBe(false);
    expect(theirs.items).toEqual([]);
    // Non-negotiable #2: a refusal must not disclose that a record exists. No
    // count, no "not yours", nothing that says there was something to hide.
    expect(JSON.stringify(theirs)).not.toContain("afternoon");
    expect(theirs.note ?? "").not.toMatch(/permission|not allowed|cannot see/i);
  });
});

describe("⚠ a fact derived from a record is re-checked at READ time", () => {
  /** A fact resting on a record only some people may open. */
  async function withDerivedFact(): Promise<MemoryStore> {
    const store = await MemoryStore.create();
    await store.remember({
      actor: "hr-004",
      domain: "leave-expenses",
      text: "book my leave against the usual cost centre",
      derivedFrom: [{ nodeType: "payroll-run", nodeId: "does-not-resolve" }],
    });
    return store;
  }

  it("is absent when the record no longer resolves for this person", async () => {
    // Permissions change; a rule never outlives its owner. The fact was
    // written when somebody could see the record — that is not evidence they
    // still can, and it is never treated as though it were.
    const store = await withDerivedFact();
    const result = await run("hr-004", store);
    expect(result.found).toBe(false);
    expect(result.items).toEqual([]);
  });

  it("does the check through spine.read, as the person asking", () => {
    const src = readFileSync("src/domains/assistant/memory/visible.ts", "utf8");
    expect(src).toContain("ctx.deps.spine.read({");
    expect(src).toContain("actor: ctx.actor");
  });

  it("a fact resting on nothing is unaffected", async () => {
    const store = await MemoryStore.create();
    await store.remember({ actor: "hr-004", domain: "day", text: "afternoon reviews" });
    expect((await run("hr-004", store)).items).toHaveLength(1);
  });

  it("one unreachable record hides the whole fact, not half of it", async () => {
    const store = await MemoryStore.create();
    await store.remember({
      actor: "hr-004",
      domain: "day",
      text: "half of this is visible",
      derivedFrom: [
        { nodeType: "employee", nodeId: "hr-004" },
        { nodeType: "payroll-run", nodeId: "does-not-resolve" },
      ],
    });
    expect((await visibleFacts(store, ctxFor("hr-004", store))).length).toBe(0);
  });
});

describe("⚠ the actor is never addressable", () => {
  it("is not in my_memory's input schema", () => {
    const src = readFileSync("src/domains/assistant/tools/memory-read.ts", "utf8");
    // The grep the plan names, applied to the file it was written about.
    expect(src).not.toMatch(/actor:\s*z\./);
  });

  it("the tool takes only an area", () => {
    const built = myMemory.build(ctxFor("hr-004", {} as unknown as MemoryStore)) as unknown as {
      inputSchema: { shape: Record<string, unknown> };
    };
    expect(Object.keys(built.inputSchema.shape)).toEqual(["area"]);
  });
});

describe("durability", () => {
  it("hydrates from what was saved, retired rows included", async () => {
    const rows: MemoryFact[] = [];
    const persistence: MemoryPersistence = {
      async save(fact) {
        const at = rows.findIndex((r) => r.id === fact.id);
        if (at >= 0) rows[at] = { ...fact };
        else rows.push({ ...fact });
      },
      async loadFor(actor) {
        return rows.filter((r) => r.actor === actor).map((r) => ({ ...r }));
      },
    };

    const first = await MemoryStore.create(persistence);
    const kept = await first.remember({ actor: "hr-004", domain: "day", text: "afternoon reviews" });
    const dropped = await first.remember({ actor: "hr-004", domain: "day", text: "wrong" });
    await first.retire("hr-004", dropped.id);
    await first.flush(kept.id);
    await first.flush(dropped.id);

    // A restart.
    const second = await MemoryStore.create(persistence, ["hr-004"]);
    expect((await second.recall("hr-004", { today: TODAY })).map((f) => f.text)).toEqual([
      "afternoon reviews",
    ]);
    // The retired row came back too — it is history, not a deletion.
    expect(await second.allFor("hr-004")).toHaveLength(2);
  });
});
