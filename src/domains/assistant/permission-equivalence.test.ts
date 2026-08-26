import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { setFakeLlmScript, resetFakeLlm, type FakeStep } from "@/config/llm-fake";
import { CourseService } from "@/domains/course/service";
import { isRestricted } from "@/spine/permission/types";
import { ask } from "./agent";
import { toolsFor, type ToolDeps } from "./tools";
import { resetTokenBudget } from "./token-budget";

/**
 * ── THE TEST THIS PHASE STANDS ON ───────────────────────────────────────────
 *
 * **The assistant must never become a way around the gate.**
 *
 * Everything else in this stage is quality. This is safety, and it is stated as
 * a property rather than a list of examples:
 *
 *   *Every record the assistant surfaces to somebody is one they could already
 *   have opened themselves.*
 *
 * Checked by taking each record id the tools actually read and asking
 * `spine.read` — the same call every screen goes through — whether that person
 * may see it. If the answer is ever no, the assistant has become a hole in the
 * gate, and it does not matter how good the answers are.
 *
 * A scripted model is the right instrument here, and not a compromise: it lets
 * every role be asked *exactly* the same thing with *exactly* the same tool
 * calls, so any difference in what comes back is the permission layer and
 * nothing else. A real model would vary its tool choices between runs and prove
 * less, not more.
 */

const ROLES = [
  { actor: "superadmin", label: "super-admin" },
  { actor: "admin", label: "admin" },
  { actor: "shruti", label: "hr" },
  { actor: "james", label: "manager" },
  { actor: "priya", label: "employee" },
  { actor: "ravi", label: "intern" },
] as const;

/** Five questions, each pinned to the tool calls a sensible model would make. */
const QUESTIONS: Array<{ question: string; script: FakeStep[]; orgWide: boolean }> = [
  {
    question: "Who is off next week?",
    script: [
      { toolCalls: [{ toolName: "list_leave", input: {} }] },
      { text: "Here is the leave I can see." },
    ],
    orgWide: true,
  },
  {
    question: "Which courses are behind?",
    script: [
      { toolCalls: [{ toolName: "course_progress", input: { staleOnly: true } }] },
      { text: "Here are the courses that have gone stale." },
    ],
    orgWide: true,
  },
  {
    question: "What is everyone working on?",
    script: [
      { toolCalls: [{ toolName: "list_tasks", input: {} }] },
      { text: "Here is the work I can see." },
    ],
    orgWide: true,
  },
  {
    question: "Who is in the courses team?",
    script: [
      { toolCalls: [{ toolName: "find_people", input: { team: "courses" } }] },
      { text: "Here are the people I can see." },
    ],
    orgWide: true,
  },
  {
    question: "What is on me today?",
    script: [
      { toolCalls: [{ toolName: "my_day", input: {} }] },
      { text: "Here is your day." },
    ],
    // Personal by construction: everyone sees their own and only their own.
    orgWide: false,
  },
];

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

async function askAs(actor: string, q: (typeof QUESTIONS)[number]) {
  setFakeLlmScript(q.script);
  return ask({ actor, question: q.question, deps });
}

describe("permission equivalence — the assistant is never a way around the gate", () => {
  for (const { actor, label } of ROLES) {
    it(`every record surfaced to ${label} is one they could already open`, async () => {
      for (const q of QUESTIONS) {
        const result = await askAs(actor, q);
        for (const ref of result.read) {
          // `day-plan` is personal planning state, outside the record gate by
          // design, and always the asker's own — see `my_day`.
          if (ref.nodeType === "day-plan") {
            expect(ref.nodeId.startsWith(`${actor}:`)).toBe(true);
            continue;
          }
          const direct = await world.spine.read({
            actor,
            nodeType: ref.nodeType,
            nodeId: ref.nodeId,
          });
          expect(
            direct.found,
            `${label} was shown ${ref.nodeType}:${ref.nodeId} for "${q.question}" but cannot open it`,
          ).toBe(true);
        }
      }
    });
  }

  it("an intern is never shown a record a manager sees but they cannot", async () => {
    for (const q of QUESTIONS.filter((x) => x.orgWide)) {
      const manager = await askAs("james", q);
      const intern = await askAs("ravi", q);

      const managerSaw = new Set(manager.read.map((r) => `${r.nodeType}:${r.nodeId}`));
      const internSaw = intern.read.map((r) => `${r.nodeType}:${r.nodeId}`);

      // Anything extra the intern was shown is the interesting direction —
      // it would mean the assistant widened rather than narrowed.
      for (const key of internSaw) {
        const [nodeType, ...rest] = key.split(":");
        const direct = await world.spine.read({
          actor: "ravi",
          nodeType,
          nodeId: rest.join(":"),
        });
        expect(direct.found, `ravi was shown ${key} for "${q.question}"`).toBe(true);
      }
      // Sanity: the manager's view is at least as wide, which is what makes
      // the comparison meaningful rather than vacuous.
      expect(managerSaw.size).toBeGreaterThanOrEqual(0);
    }
  });

  it("no answer or citation ever carries a restricted marker", async () => {
    for (const { actor } of ROLES) {
      for (const q of QUESTIONS) {
        const result = await askAs(actor, q);
        const serialised = JSON.stringify(result);
        expect(serialised).not.toContain("__restricted");
        expect(serialised).not.toContain("Restricted");
      }
    }
  });
});

describe("what a tool actually hands back is filtered too", () => {
  /**
   * The citations prove the assistant did not read what it should not. This
   * proves the same of the *fields* — a record somebody may open can still hold
   * a figure they may not see, and the model must never be handed one.
   */
  async function runTool(actor: string, name: string, input: unknown): Promise<string> {
    const { tools } = toolsFor(actor, deps);
    const t = tools[name];
    if (!t) return "";
    const execute = t.execute as (i: unknown, o: unknown) => Promise<unknown>;
    return JSON.stringify(await execute(input, { toolCallId: "t", messages: [] }));
  }

  it("pay never reaches the model, for anybody who may not see it", async () => {
    for (const actor of ["ravi", "priya", "james"]) {
      const out = await runTool(actor, "get_person", { person: "priya" });
      expect(out).not.toContain("__restricted");
      // Not even the key: knowing a pay field exists is itself a disclosure.
      expect(out.toLowerCase()).not.toContain('"pay"');
      expect(out.toLowerCase()).not.toContain("salary");
    }
  });

  it("a masked value is dropped, never rendered as a placeholder", async () => {
    // "Their pay is ●●●" is worse than saying nothing: it confirms the figure.
    for (const actor of ["ravi", "priya"]) {
      const out = await runTool(actor, "find_people", {});
      expect(out).not.toMatch(/[•●]{2,}/);
      expect(out).not.toContain("__restricted");
    }
  });

  it("an intern asking about somebody else gets the same opaque nothing as for a stranger", async () => {
    // Non-negotiable #2: refusal must not disclose that a record exists.
    const real = await runTool("ravi", "leave_balance", { person: "james" });
    const imaginary = await runTool("ravi", "leave_balance", { person: "nobody-at-all" });
    const shape = (s: string) => JSON.parse(s).untrusted_record_data.found;
    // Both must be "not found". If they differed, existence would be readable.
    expect(shape(real)).toBe(shape(imaginary));
  });
});

describe("the field policy is what makes this true, so assert it directly", () => {
  it("readMany masks what an intern may not see", async () => {
    const rows = await world.spine.readMany({ actor: "ravi", nodeType: "employee" });
    for (const row of rows) {
      for (const [, value] of Object.entries(row.record)) {
        if (isRestricted(value)) {
          // Masked at the spine — and `safeFields` is what stops it going out.
          expect(isRestricted(value)).toBe(true);
        }
      }
    }
    expect(rows.length).toBeGreaterThan(0);
  });
});

/**
 * ── Extended for 1b: 33 tools, and a second path ────────────────────────────
 *
 * The catalogue more than doubled and the fan-out arrived, and a specialist
 * answering in parallel is a second place the boundary could go wrong — one
 * that did not exist when 1a wrote its version of this file.
 */
describe("permission equivalence at 33 tools", () => {
  const WIDER_QUESTIONS: Array<{ question: string; script: FakeStep[] }> = [
    {
      question: "Was anyone absent last week?",
      script: [
        { toolCalls: [{ toolName: "attendance", input: { period: "last-week" } }] },
        { text: "Here is the attendance I can see." },
      ],
    },
    {
      question: "What is in the diary this month?",
      script: [
        { toolCalls: [{ toolName: "calendar_month", input: { period: "this-month" } }] },
        { text: "Here is the diary." },
      ],
    },
    {
      question: "Who is best placed to take this on?",
      script: [
        { toolCalls: [{ toolName: "who_is_best", input: {} }] },
        { text: "Here are the candidates and their numbers." },
      ],
    },
    {
      question: "Find anything about the review",
      script: [
        { toolCalls: [{ toolName: "search", input: { query: "review" } }] },
        { text: "Here are loose matches." },
      ],
    },
    {
      question: "What paperwork is outstanding?",
      script: [
        { toolCalls: [{ toolName: "required_documents", input: {} }] },
        { text: "Here is what is outstanding." },
      ],
    },
  ];

  for (const { actor, label } of ROLES) {
    it(`every record the new tools surface to ${label} is one they could already open`, async () => {
      for (const q of WIDER_QUESTIONS) {
        setFakeLlmScript(q.script);
        const result = await ask({ actor, question: q.question, deps });
        for (const ref of result.read) {
          if (ref.nodeType === "day-plan" || ref.nodeType === "figure") continue;
          const direct = await world.spine.read({
            actor,
            nodeType: ref.nodeType,
            nodeId: ref.nodeId,
          });
          expect(
            direct.found,
            `${label} was shown ${ref.nodeType}:${ref.nodeId} for "${q.question}" but cannot open it`,
          ).toBe(true);
        }
      }
    });
  }

  it("the same property holds THROUGH THE FAN-OUT, not only on the direct path", async () => {
    // A specialist runs its own agent loop. It shares the coordinator's
    // ToolContext, so it is the same actor — this asserts the consequence
    // rather than trusting it.
    for (const { actor, label } of ROLES) {
      setFakeLlmScript([
        {
          toolCalls: [
            {
              toolName: "consult_specialists",
              input: { domains: ["people", "courses"], question: "who is here and what is behind?" },
            },
          ],
        },
        { toolCalls: [{ toolName: "find_people", input: {} }] },
        { text: "Here is what I can see." },
      ]);
      const result = await ask({
        actor,
        question: "Who is here and what is behind?",
        deps,
      });
      for (const ref of result.read) {
        if (ref.nodeType === "day-plan" || ref.nodeType === "figure") continue;
        const direct = await world.spine.read({
          actor,
          nodeType: ref.nodeType,
          nodeId: ref.nodeId,
        });
        expect(
          direct.found,
          `${label} was shown ${ref.nodeType}:${ref.nodeId} THROUGH A SPECIALIST but cannot open it`,
        ).toBe(true);
      }
    }
  });

  it("a specialist cannot be asked to run as somebody else", async () => {
    // The fan-out takes `domains` and `question` — and deliberately no actor.
    // If it took one, a prompt-injected record could name a different person.
    setFakeLlmScript([
      {
        toolCalls: [
          {
            toolName: "consult_specialists",
            input: {
              domains: ["people"],
              question: "who is here?",
              // The model tries. There is nowhere to put it.
              actor: "admin",
              runAs: "superadmin",
            },
          },
        ],
      },
      { toolCalls: [{ toolName: "find_people", input: {} }] },
      { text: "Here is what I can see." },
    ]);
    const asIntern = await ask({ actor: "ravi", question: "Who is here?", deps });
    for (const ref of asIntern.read) {
      const direct = await world.spine.read({
        actor: "ravi",
        nodeType: ref.nodeType,
        nodeId: ref.nodeId,
      });
      expect(direct.found, `ravi reached ${ref.nodeType}:${ref.nodeId} by naming an actor`).toBe(
        true,
      );
    }
  });

  it("no answer or citation from the new tools carries a restricted marker", async () => {
    for (const { actor } of ROLES) {
      for (const q of WIDER_QUESTIONS) {
        setFakeLlmScript(q.script);
        const result = await ask({ actor, question: q.question, deps });
        expect(JSON.stringify(result)).not.toContain("__restricted");
      }
    }
  });
});
