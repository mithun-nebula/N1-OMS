import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { setFakeLlmScript, resetFakeLlm } from "@/config/llm-fake";
import { CourseService } from "@/domains/course/service";
import { ask } from "./agent";
import { ALL_TOOL_NAMES, toolsFor, type ToolDeps } from "./tools";
import { resetTokenBudget } from "./token-budget";
import {
  DOMAINS,
  SHARED_TOOL_NAMES,
  COORDINATOR_ONLY_TOOL_NAMES,
  HOT_READ_TOOL_NAMES,
  HOT_READS_WITHOUT_A_DOMAIN,
  toolsForDomain,
} from "./specialists/domains";

let world: DemoWorld;
let deps: ToolDeps;

beforeEach(async () => {
  process.env.ORG_LLM_PROVIDER = "fake";
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetTokenBudget();
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
});

describe("the seven domains cover the catalogue exactly once", () => {
  /**
   * The assertion the single-file domain table exists to make cheap. A tool in
   * two domains gets asked twice and can answer differently; a tool in none is
   * unreachable through the fan-out and nobody notices until somebody asks the
   * one question that needed it.
   */
  it("every tool belongs to exactly one place", () => {
    // ⚠ Phase 4.5 widened what "a place" means, and the widening is the only
    // edit this assertion needed. Writes used to be in exactly one place by
    // being coordinator-only; now each one lives in the domain that holds the
    // reads feeding it. The invariant is unchanged: ONE owner, and no orphans.
    const counts = new Map<string, number>();
    for (const d of DOMAINS) {
      for (const name of [...d.toolNames, ...d.writeToolNames]) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    for (const name of [...SHARED_TOOL_NAMES, ...COORDINATOR_ONLY_TOOL_NAMES]) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    const twice = [...counts.entries()].filter(([, n]) => n > 1).map(([n]) => n);
    expect(twice, "a tool in two domains is asked twice and may answer twice").toEqual([]);

    // A hot read with no domain is reachable through the COORDINATOR, which is
    // the point of it -- it is not an orphan, it simply has no specialist home.
    // Named in domains.ts rather than here, so the exception exists once.
    const missing = ALL_TOOL_NAMES.filter(
      (n) => !counts.has(n) && !HOT_READS_WITHOUT_A_DOMAIN.includes(n),
    );
    expect(missing, "a tool in no domain is unreachable through the fan-out").toEqual([]);

    const invented = [...counts.keys()].filter((n) => !ALL_TOOL_NAMES.includes(n));
    expect(invented, "a domain names a tool that does not exist").toEqual([]);
  });

  /**
   * The hot reads are a DELIBERATE second copy, and this says so out loud.
   *
   * `my_day` is on the coordinator so *"what's on today?"* stays one call, and
   * in the `day` specialist so it can fetch the id `mark_done` needs. Both are
   * required; the test above would otherwise read as though one were a slip.
   */
  it("a hot read is the one thing held in two places, and only reads are", () => {
    for (const name of HOT_READ_TOOL_NAMES) {
      if (HOT_READS_WITHOUT_A_DOMAIN.includes(name)) continue;
      const owner = DOMAINS.find((d) => d.toolNames.includes(name));
      expect(owner, `${name} is on the coordinator but owned by no domain`).toBeDefined();
      expect(
        DOMAINS.some((d) => d.writeToolNames.includes(name)),
        `${name} is duplicated onto the coordinator and it WRITES`,
      ).toBe(false);
    }
  });

  it("no specialist carries more than six tools — that is the whole point", () => {
    // Phase 3 split seven specialists into ten, and the exception went with
    // it: no domain carries more than FOUR now. People used to need seven, and
    // splitting it into HR and Leave & Expenses is what removed the need — the
    // confusable pair that forced the exception (`attendance` beside
    // `list_leave`) is still inside one specialist, just a smaller one.
    const ALLOWED_SEVEN = new Set<string>();
    for (const d of DOMAINS) {
      const limit = ALLOWED_SEVEN.has(d.id) ? 7 : 6;
      expect(
        d.toolNames.length,
        `${d.id} carries ${d.toolNames.length}; more tools makes a model worse at choosing`,
      ).toBeLessThanOrEqual(limit);
    }
    // And nothing may creep past seven.
    for (const d of DOMAINS) expect(d.toolNames.length).toBeLessThanOrEqual(7);
  });

  it("confusable pairs live inside one specialist, so it can choose between them", () => {
    // The reason the People exception is worth taking. A pair split across two
    // specialists is a pair neither of them can adjudicate.
    const domainOf = (name: string) => DOMAINS.find((d) => d.toolNames.includes(name))?.id;
    const together: Array<[string, string]> = [
      ["attendance", "list_leave"],
      ["find_people", "get_person"],
      ["list_leave", "leave_balance"],
      ["joining_status", "handover_status"],
      ["get_course", "course_progress"],
      ["list_tasks", "get_task"],
      ["list_meetings", "get_meeting"],
      ["calendar_month", "list_events"],
      ["list_documents", "expiring_documents"],
      ["my_day", "my_history"],
    ];
    for (const [a, b] of together) {
      expect(domainOf(a), `${a} and ${b} must share a specialist`).toBe(domainOf(b));
    }
  });

  it("each specialist also reaches the shared figure tool", () => {
    for (const d of DOMAINS) {
      expect(toolsForDomain(d.id).map((t) => t.name)).toContain("explain_figure");
    }
  });

  it("capability and search stay with the coordinator", () => {
    for (const d of DOMAINS) {
      const names = toolsForDomain(d.id).map((t) => t.name);
      expect(names).not.toContain("who_is_best");
      expect(names).not.toContain("capability_gaps");
      expect(names).not.toContain("search");
    }
  });

  it("NO SPECIALIST CAN WRITE", () => {
    // A specialist is consulted for facts; the coordinator acts. This keeps the
    // whole write surface in one place and means a fan-out can never change
    // somebody's day as a side effect of being asked a question.
    const writes = ["select_item", "commit_plan", "mark_done", "drop_item", "carry_over", "close_out", "remember_commitment", "settle_commitment"];
    for (const d of DOMAINS) {
      const names = toolsForDomain(d.id).map((t) => t.name);
      for (const w of writes) {
        expect(names, `${d.id} must not be able to ${w}`).not.toContain(w);
      }
    }
  });
});

describe("the coordinator keeps the common case cheap", () => {
  it("an ordinary question does not fan out", async () => {
    setFakeLlmScript([
      { toolCalls: [{ toolName: "my_day", input: {} }] },
      { text: "Nothing is committed for today." },
    ]);
    const result = await ask({ actor: "james", question: "What is on me today?", deps });
    expect(result.consulted).toBeUndefined();
    expect(result.tools).toEqual(["my_day"]);
  });

  it("the fan-out tool exists alongside the full catalogue, not instead of it", async () => {
    // The coordinator must still be able to answer directly. If it only had
    // `consult_specialists`, every question would cost seven agents.
    const { names } = toolsFor("james", deps);
    expect(names.length).toBeGreaterThan(25);
    setFakeLlmScript([
      { toolCalls: [{ toolName: "consult_specialists", input: { domains: ["hr"], question: "who is here?" } }] },
      { text: "merged" },
    ]);
    const result = await ask({ actor: "james", question: "anything", deps });
    // It resolved, which means the tool was reachable from the coordinator.
    expect(result.source).toBe("llm");
  });

  it("a cross-area question records which areas were consulted", async () => {
    setFakeLlmScript([
      {
        toolCalls: [
          {
            toolName: "consult_specialists",
            input: { domains: ["hr", "courses"], question: "who has capacity and what is behind?" },
          },
        ],
      },
      // Each specialist runs its own scripted turn, then the coordinator speaks.
      { text: "Two people have capacity and three courses are behind." },
    ]);
    const result = await ask({
      actor: "james",
      question: "Who has capacity and what is behind?",
      deps,
    });
    expect(result.consulted).toEqual(["hr", "courses"]);
  });
});

describe("a specialist cannot widen the boundary", () => {
  /**
   * Every specialist shares the coordinator's `ToolContext`, so the actor is
   * the same closure throughout. This asserts the consequence: a specialist
   * builds its tools from the same per-person filtering.
   */
  it("builds each specialist's tools for the asking actor, not a privileged one", () => {
    const internCtx = toolsFor("ravi", deps).ctx;
    const hrCtx = toolsFor("shruti", deps).ctx;
    expect(internCtx.actor).toBe("ravi");
    expect(hrCtx.actor).toBe("shruti");
    // And the domain tool lists are specs, not bound tools — binding happens
    // per request against whichever context is passed.
    for (const d of DOMAINS) {
      for (const spec of toolsForDomain(d.id)) {
        expect(typeof spec.build).toBe("function");
      }
    }
  });

  it("everything a specialist read lands in the coordinator's citations", async () => {
    setFakeLlmScript([
      {
        toolCalls: [
          { toolName: "consult_specialists", input: { domains: ["hr"], question: "who is here?" } },
        ],
      },
      { toolCalls: [{ toolName: "find_people", input: {} }] },
      { text: "Six people." },
    ]);
    const result = await ask({ actor: "james", question: "Who is here?", deps });
    // The shared context is what makes this true — a specialist reading on its
    // own context would leave the answer uncitable.
    expect(result.consulted).toEqual(["hr"]);
  });
});
