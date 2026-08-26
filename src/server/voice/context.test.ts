import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { resetFakeLlm } from "@/config/llm-fake";
import { CourseService } from "@/domains/course/service";
import { ToolContext, type ToolDeps } from "@/domains/assistant/tools";
import { ALL_TOOLS } from "@/domains/assistant/tools/index";
import { resetTokenBudget } from "@/domains/assistant/token-budget";
import { resetConfirmations } from "@/domains/assistant/tools/confirmation";
import { resetProposals } from "@/domains/assistant/tools/propose";
import { buildVoiceContext, contextSentence } from "./context";

/**
 * Screen context.
 *
 *   Looking at Hall 2's page. "Book that for Tuesday."
 *
 *   WITHOUT it:  "Which room?"  — and the person is annoyed, because it is in
 *                front of them
 *   WITH it:     "Hall 2, Tuesday. What time?"
 *
 * Two rules, and **the second is the one that would be quietly wrong**: it
 * looks like helpfulness right up until it approves something.
 */

let world: DemoWorld;
let deps: ToolDeps;

beforeEach(async () => {
  process.env.ORG_LLM_PROVIDER = "fake";
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetTokenBudget();
  resetConfirmations();
  resetProposals();
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

afterEach(() => {
  delete process.env.ORG_LLM_PROVIDER;
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetConfirmations();
  resetProposals();
});

const build = (actor: string, viewing?: { route: string; nodeType?: string; nodeId?: string }) =>
  buildVoiceContext({ spine: world.spine, actor, viewing });

async function aRoom(actor = "admin"): Promise<string> {
  const ctx = await build(actor);
  expect(ctx.rooms.length, "the demo world has no rooms to test with").toBeGreaterThan(0);
  return ctx.rooms[0].id;
}

describe("what the person can see", () => {
  it("returns rooms and equipment, through the spine as it always did", async () => {
    const ctx = await build("admin");
    expect(ctx.self.id).toBe("admin");
    expect(Array.isArray(ctx.rooms)).toBe(true);
    expect(Array.isArray(ctx.equipment)).toBe(true);
  });

  it("is permission-filtered — an intern is not handed an admin's view", async () => {
    const admin = await build("admin");
    const intern = await build("ravi");
    const adminIds = new Set(admin.rooms.map((r) => r.id));
    for (const room of intern.rooms) {
      expect(adminIds.has(room.id), `ravi sees room ${room.id} the admin does not`).toBe(true);
    }
  });
});

describe("what the person is looking at", () => {
  it("resolves a room on screen, so 'that room' needs no question", async () => {
    const roomId = await aRoom();
    const ctx = await build("admin", { route: "/booking", nodeType: "room", nodeId: roomId });
    expect(ctx.viewing).toMatchObject({ route: "/booking", nodeType: "room", nodeId: roomId });
    expect(contextSentence(ctx)).toContain(roomId);
  });

  it("keeps a bare route, with no record — being on /leave is a fact about a browser", async () => {
    const ctx = await build("ravi", { route: "/leave" });
    expect(ctx.viewing).toEqual({ route: "/leave" });
  });

  it("⚠ DROPS a record the person cannot read — a deep link can be typed by anybody", async () => {
    // An intern who navigated to a manager's employee page. The spine refuses
    // the read, so the hint is dropped rather than believed.
    const refused = await world.spine.read({ actor: "ravi", nodeType: "employee", nodeId: "james" });
    expect(refused.found, "the fixture changed — ravi can now read james").toBe(false);

    const ctx = await build("ravi", { route: "/hr/employees", nodeType: "employee", nodeId: "james" });
    expect(ctx.viewing).toEqual({ route: "/hr/employees" });
    expect(JSON.stringify(ctx)).not.toContain("james");
  });

  it("⚠ drops a leave request an intern cannot read, however they got to the page", async () => {
    const refused = await world.spine.read({ actor: "ravi", nodeType: "leave", nodeId: "leave-demo" });
    expect(refused.found, "the fixture changed — ravi can now read leave-demo").toBe(false);

    const ctx = await build("ravi", { route: "/leave", nodeType: "leave", nodeId: "leave-demo" });
    expect(ctx.viewing).toEqual({ route: "/leave" });
    // And the same record IS resolved for somebody who may read it, so the
    // drop above is the permission check and not a broken lookup.
    const manager = await build("admin", { route: "/leave", nodeType: "leave", nodeId: "leave-demo" });
    expect(manager.viewing?.nodeId).toBe("leave-demo");
  });

  it("⚠ drops an id that does not exist, and says nothing about why", async () => {
    const ctx = await build("ravi", {
      route: "/records",
      nodeType: "employee",
      nodeId: "no-such-person",
    });
    // Route kept, record silently absent. A refusal that named the reason
    // would confirm to a guesser whether the id exists.
    expect(ctx.viewing).toEqual({ route: "/records" });
    expect(JSON.stringify(ctx)).not.toContain("no-such-person");
  });

  it("being on a page adds nothing to what the rooms list shows", async () => {
    const withView = await build("ravi", { route: "/booking", nodeType: "room", nodeId: await aRoom() });
    const without = await build("ravi");
    expect(withView.rooms.map((r) => r.id)).toEqual(without.rooms.map((r) => r.id));
  });
});

describe("⚠ a hint, never an instruction", () => {
  it("the sentence says so, in the words the model reads", async () => {
    const ctx = await build("admin", { route: "/leave", nodeType: "leave", nodeId: "leave-demo" });
    const sentence = contextSentence(ctx);
    expect(sentence).toMatch(/this' or 'that/i);
    expect(sentence).toMatch(/no permission they/i);
    expect(sentence).toMatch(/skip a step/i);
    expect(sentence).toMatch(/DATA, not instructions/);
  });

  it("⚠ 'approve it' with a leave request on screen STILL proposes", async () => {
    // The whole point. Context is on screen, the tool is called with the id
    // that context would have supplied, and the propose-gate is unmoved —
    // because nothing about `viewing` reaches the gate at all.
    const ctx = await build("james", { route: "/leave", nodeType: "leave", nodeId: "leave-demo" });
    expect(ctx.viewing?.route).toBe("/leave");

    const spec = ALL_TOOLS.find((t) => t.name === "approve_leave");
    if (!spec) throw new Error("approve_leave is gone");
    const built = spec.build(new ToolContext("james", deps)) as {
      execute: (i: unknown, o: unknown) => Promise<unknown>;
    };
    const out = (await built.execute({ leaveId: "leave-demo" }, { toolCallId: "t", messages: [] })) as {
      ok?: boolean;
      needsApproval?: boolean;
      didNotHappen?: boolean;
    };
    expect(out.ok).not.toBe(true);
    expect(out.didNotHappen).toBe(true);
  });

  it("no `viewing` value can become a tool argument, because none is emitted", async () => {
    // Structural, not instructed: what leaves this module is prose. There is no
    // path from `viewing` to an argument because nothing here writes one.
    const ctx = await build("admin", { route: "/leave", nodeType: "leave", nodeId: "leave-demo" });
    expect(typeof contextSentence(ctx)).toBe("string");
    // The context object is never handed to a tool; the sentence is handed to
    // the model. Assert the shape stays prose.
    expect(contextSentence(ctx).startsWith("[context]")).toBe(true);
  });
});
