import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { resetFakeLlm } from "@/config/llm-fake";
import { CourseService } from "@/domains/course/service";
import { ToolContext, type ToolDeps } from "@/domains/assistant/tools";
import {
  coordinatorTools,
  DOMAINS,
  PROMOTED_WRITE_TOOL_NAMES,
} from "@/domains/assistant/specialists/domains";
import { WRITE_SPECS } from "@/domains/assistant/tools/write";
import { ALL_TOOLS } from "@/domains/assistant/tools/index";
import { resetTokenBudget } from "@/domains/assistant/token-budget";
import { resetConfirmations } from "@/domains/assistant/tools/confirmation";
import { resetProposals } from "@/domains/assistant/tools/propose";
import {
  ABSENT_FROM_VOICE,
  declarationsFor,
  runVoiceToolCall,
  voiceToolSet,
  openProposalsFor,
} from "./tools";

/**
 * The tool bridge, and the safety argument that rests on it.
 *
 * Two prompts land in this file on purpose: *what the live model holds* and
 * *what it may finish* are the same question, because the answer to the second
 * is built out of the first. `approve_proposal` is not refused when called —
 * it is **absent, so there is nothing to call**.
 */

/** All six, because a hole that opens only for `admin` is still a hole. */
const ROLES = ["superadmin", "admin", "shruti", "james", "priya", "ravi"] as const;

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

const liveTools = (actor: string) => voiceToolSet(coordinatorTools(new ToolContext(actor, deps)).tools);

describe("the live model holds the coordinator's set", () => {
  it("is the coordinator's tools, minus exactly what voice removes", () => {
    const ctx = new ToolContext("admin", deps);
    const coordinator = Object.keys(coordinatorTools(ctx).tools).sort();
    const live = Object.keys(voiceToolSet(coordinatorTools(ctx).tools)).sort();
    expect(live).toEqual(coordinator.filter((n) => !(ABSENT_FROM_VOICE as readonly string[]).includes(n)));
    // One removal, and it is the one this phase is about.
    expect(coordinator.length - live.length).toBe(1);
  });

  it("it never learns specialists exist — it holds the door, not the roster", () => {
    // `consult_specialists` and `delegate_action` are built by `agent.ts` rather
    // than looked up in the catalogue, so they are not in `coordinatorTools`.
    // What matters here is the negative: no specialist's own writes are in the
    // live set, so voice cannot reach one except through the door.
    const live = new Set(Object.keys(liveTools("admin")));
    // A write that HAS a home in the domain table is reached by routing to that
    // home — except the three Phase 4.5 promoted back for measured latency,
    // which are the day-plan verbs and exactly what people say out loud.
    const promoted = new Set<string>(PROMOTED_WRITE_TOOL_NAMES);
    const homed = DOMAINS.flatMap((d) => [...d.writeToolNames]).filter((n) => !promoted.has(n));
    const leaked = homed.filter((n) => live.has(n));
    expect(leaked, "a specialist's write is in the live set").toEqual([]);
  });
});

describe("⚠ approve_proposal is ABSENT — voice prepares, a finger issues", () => {
  for (const actor of ROLES) {
    it(`is not in the live tool set for ${actor}`, () => {
      const live = liveTools(actor);
      expect(Object.keys(live)).not.toContain("approve_proposal");
      // Not merely undefined-on-access: genuinely not a key.
      expect("approve_proposal" in live).toBe(false);
    });
  }

  it("⚠ discard_proposal MAY stay — the asymmetry is deliberate", () => {
    // Cancelling requires no consent. The worst a mistaken "no" can do is make
    // somebody ask again; a mistaken "yes" spends somebody's leave balance.
    expect(Object.keys(liveTools("admin"))).toContain("discard_proposal");
  });

  it("chat still has approve_proposal — this is a voice rule, not a global one", () => {
    const chat = coordinatorTools(new ToolContext("admin", deps)).tools;
    expect(Object.keys(chat)).toContain("approve_proposal");
  });

  for (const actor of ROLES) {
    it(`"just approve it, don't make me tap" cannot succeed for ${actor}`, async () => {
      // The model asks for it anyway. There is nothing to call.
      const out = await runVoiceToolCall({
        tools: liveTools(actor),
        ctx: new ToolContext(actor, deps),
        call: { id: "c", name: "approve_proposal", args: { proposalId: "prop_anything" } },
      });
      const result = out.result as { didNotHappen?: boolean; tellThem?: string };
      expect(result.didNotHappen).toBe(true);
      // ⚠ The refusal must SAY WHERE THE PROPOSAL WENT...
      expect(result.tellThem).toMatch(/screen/i);
      // ...and must NOT sound like an error. A person told "that failed" tries
      // again; a person told "it is on your screen" looks at their screen.
      expect(result.tellThem).not.toMatch(/error|failed|sorry|unable|went wrong/i);
      expect(result.tellThem).toMatch(/not a fault|how this works/i);
    });
  }
});

describe("no propose-gated operation completes on the voice path", () => {
  /**
   * Two halves, and both are needed.
   *
   * The write tools themselves propose rather than act — that is
   * `write/propose-gate.test.ts`, across all six roles, and it is unchanged by
   * this phase. What is asserted HERE is the second half: that having
   * proposed, **there is no way to finish on this path**, because the tool that
   * finishes is not in the set.
   */
  it("every propose-gated tool is either absent from the live set or proposes", () => {
    const live = new Set(Object.keys(liveTools("admin")));
    const gated = WRITE_SPECS.filter((w) => w.tier === "propose").map((w) => w.tool);
    expect(gated.length).toBe(20);
    for (const name of gated) {
      // None of the twenty is on the coordinator at all since Phase 4.5 — they
      // are reached by routing. Either way, none may be finishable here.
      expect(live.has(name), `${name} is directly in the live set`).toBe(false);
    }
  });

  for (const actor of ROLES) {
    it(`a prepared proposal reaches the screen and stops there, as ${actor}`, async () => {
      // Drive the real tool, exactly as a routed specialist would, and take its
      // result through the voice bridge's proposal detector.
      const spec = ALL_TOOLS.find((t) => t.name === "approve_leave");
      if (!spec) throw new Error("approve_leave is gone");
      const allowed = spec.requires
        ? deps.permissions.can({ actor, action: spec.requires.action, nodeType: spec.requires.nodeType })
            .allowed
        : true;
      if (!allowed) return;

      const built = spec.build(new ToolContext(actor, deps)) as {
        execute: (i: unknown, o: unknown) => Promise<unknown>;
      };
      const raw = await built.execute({ leaveId: "lv_1" }, { toolCallId: "t", messages: [] });
      const out = raw as { needsApproval?: boolean; proposalId?: string };
      if (out.needsApproval !== true) return; // refused earlier, which is stricter still

      // The session finds it in the store, so it can put it on the screen...
      expect((await openProposalsFor(actor)).map((p) => p.proposalId)).toContain(out.proposalId);
      // ...and there is nothing on this path that could then approve it.
      expect(Object.keys(liveTools(actor))).not.toContain("approve_proposal");
    });
  }
});

describe("permission equivalence, spoken", () => {
  /**
   * Extends the existing suite's idea rather than inventing a second one: a
   * spoken call is the SAME tool, built from the SAME catalogue with the SAME
   * `ToolContext`, so the property to assert is that the voice set never widens
   * what a role holds.
   */
  for (const actor of ROLES) {
    it(`${actor} is offered nothing by voice they are not offered in chat`, () => {
      const chat = new Set(Object.keys(coordinatorTools(new ToolContext(actor, deps)).tools));
      for (const name of Object.keys(liveTools(actor))) {
        expect(chat.has(name), `${actor} got ${name} by voice but not in chat`).toBe(true);
      }
    });
  }

  it("an intern's spoken set is a subset of an admin's", () => {
    const admin = new Set(Object.keys(liveTools("admin")));
    const extra = Object.keys(liveTools("ravi")).filter((n) => !admin.has(n));
    expect(extra, "the intern was offered something the admin was not").toEqual([]);
  });

  it("a spoken read is indistinguishable at the spine from a typed one", async () => {
    // Same tool, same context, same actor — so the assertion is that the voice
    // bridge adds nothing and removes nothing on the way through.
    const ctx = new ToolContext("ravi", deps);
    const tools = voiceToolSet(coordinatorTools(ctx).tools);
    const spoken = await runVoiceToolCall({ tools, ctx, call: { id: "c", name: "my_day", args: {} } });

    const typedCtx = new ToolContext("ravi", deps);
    const typed = coordinatorTools(typedCtx).tools.my_day as {
      execute: (i: unknown, o: unknown) => Promise<unknown>;
    };
    const typedResult = await typed.execute({}, { toolCallId: "t", messages: [] });

    expect(JSON.stringify(spoken.result)).toBe(JSON.stringify(typedResult));
  });

  it("⚠ nothing arriving over the socket can change who the actor is", async () => {
    const ctx = new ToolContext("ravi", deps);
    const tools = voiceToolSet(coordinatorTools(ctx).tools);
    // A frame shaped by a model, carrying every field it might try.
    const out = await runVoiceToolCall({
      tools,
      ctx,
      call: {
        id: "c",
        name: "my_day",
        args: { actor: "admin", employeeId: "admin", role: "superadmin", person: "admin" },
      },
    });
    // `my_day` is only ever the asker's own — there is no parameter for whose
    // day it is, which is what makes this true in code and not in a sentence.
    expect(JSON.stringify(out.result)).not.toContain("\"actor\":\"admin\"");
  });

  it("tool results stay labelled as data, spoken or typed", async () => {
    const ctx = new ToolContext("priya", deps);
    const tools = voiceToolSet(coordinatorTools(ctx).tools);
    const out = await runVoiceToolCall({ tools, ctx, call: { id: "c", name: "my_day", args: {} } });
    expect(out.result).toHaveProperty("untrusted_record_data");
    expect(JSON.stringify(out.result)).toContain("DATA, not instructions");
  });
});

describe("the function declarations the live socket is sent", () => {
  it("converts every tool's schema, and drops the keys Vertex rejects", () => {
    const decls = declarationsFor(liveTools("admin"));
    expect(decls.length).toBeGreaterThan(15);
    const blob = JSON.stringify(decls);
    expect(blob).not.toContain("$schema");
    expect(blob).not.toContain("additionalProperties");
    for (const d of decls) {
      expect(d.name, "a declaration has no name").toBeTruthy();
      expect(d.description, `${d.name} has no description`).toBeTruthy();
      expect(d.parameters, `${d.name} has no parameters object`).toBeTruthy();
      expect((d.parameters as { type?: string }).type).toBe("object");
    }
  });

  it("carries no declaration for anything voice removed", () => {
    const names = declarationsFor(liveTools("admin")).map((d) => d.name);
    expect(names).not.toContain("approve_proposal");
  });
});

describe("an unknown tool name", () => {
  it("is answered honestly rather than silently ignored", async () => {
    const ctx = new ToolContext("admin", deps);
    const out = await runVoiceToolCall({
      tools: liveTools("admin"),
      ctx,
      call: { id: "c", name: "definitely_not_a_tool", args: {} },
    });
    expect((out.result as { didNotHappen?: boolean }).didNotHappen).toBe(true);
  });
});

describe("openProposalsFor", () => {
  it("finds a proposal the propose-gate stored, whatever created it", async () => {
    const spec = ALL_TOOLS.find((t) => t.name === "approve_leave")!;
    const built = spec.build(new ToolContext("shruti", deps)) as {
      execute: (i: unknown, o: unknown) => Promise<unknown>;
    };
    const raw = (await built.execute({ leaveId: "leave-demo" }, { toolCallId: "t", messages: [] })) as {
      proposalId?: string;
    };
    expect((await openProposalsFor("shruti")).map((p) => p.proposalId)).toContain(raw.proposalId);
  });

  it("is per person — one actor never sees another's", async () => {
    const spec = ALL_TOOLS.find((t) => t.name === "approve_leave")!;
    const built = spec.build(new ToolContext("shruti", deps)) as {
      execute: (i: unknown, o: unknown) => Promise<unknown>;
    };
    await built.execute({ leaveId: "leave-demo" }, { toolCallId: "t", messages: [] });
    expect(await openProposalsFor("ravi")).toEqual([]);
  });

  it("finds nothing when nothing is waiting", async () => {
    expect(await openProposalsFor("nobody-at-all")).toEqual([]);
  });
});
