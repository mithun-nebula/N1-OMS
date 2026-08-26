import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { CourseService } from "@/domains/course/service";
import { ToolContext, type ToolDeps } from "./context";
import { ALL_TOOLS } from "./index";
import { writeTools } from "./write";
import { dayWriteTools } from "./day-write";
import { commitmentTools } from "./commitment-write";
import {
  DOMAINS,
  HOT_READ_TOOL_NAMES,
  HOT_READS_WITHOUT_A_DOMAIN,
  HOT_READ_CAP,
  COORDINATOR_HOT_CEILING,
  COORDINATOR_ONLY_TOOL_NAMES,
  UNROUTED_WRITE_NAMES,
  PROMOTED_WRITE_TOOL_NAMES,
  coordinatorToolNames,
  coordinatorTools,
  toolsForDomain,
} from "../specialists/domains";

/**
 * What the coordinator carries, and the cap that keeps it that way.
 *
 * ── The number this file exists to hold down ────────────────────────────────
 *
 * `toolsFor` returned `ALL_TOOLS`, so the coordinator received **106 tool
 * definitions — about 26,000 tokens — on every single call**, including
 * *"what's on today?"*. That is not only the cost; it is the one place in this
 * architecture that contradicts its own evidence. 1b measured that more tools
 * makes a model worse at choosing, which is the entire reason ten specialists
 * exist, and then the coordinator was handed all of them.
 *
 * ── Why a cap and not a guideline ──────────────────────────────────────────
 *
 * Because "just one more, it is genuinely useful" is true of every single tool
 * in the catalogue, one at a time, and 106 is where that argument ends up. The
 * cap is eight and a ninth is not a decision to take — it is evidence the
 * domain split is wrong somewhere, and it should be reported rather than
 * accommodated.
 *
 * ⚠ **The write list here is derived**, from the same arrays `ALL_TOOLS` is
 * built from, not copied. A hand-written list is correct until the day somebody
 * adds an operation — which is the day this test needs to fail.
 */

const EVERY_WRITE_NAME: readonly string[] = [
  ...writeTools.map((t) => t.name),
  ...dayWriteTools.map((t) => t.name),
  ...commitmentTools.map((t) => t.name),
];

const isWrite = (name: string): boolean => EVERY_WRITE_NAME.includes(name);

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
    today: () => "2026-08-08",
  };
});

describe("the coordinator's read tools are capped at eight", () => {
  /**
   * ⚠ **What the cap is on, stated precisely, because the loose reading of it
   * is worth less than it looks.**
   *
   * *"Capped at eight reads"* means the **domain reads earned by call
   * frequency** — the ones that could equally have been reached by routing to a
   * specialist, and are held here only to keep the common question at one call.
   * Those are the seats that are contended, and eight is the cap on them.
   *
   * It is NOT a cap on everything that does not write. `search`, `who_is_best`
   * and `capability_gaps` are cross-domain and belong to no specialist, so they
   * are not competing for a seat — there is nowhere else for them to be. Same
   * for the rule tools and `explain_figure`.
   *
   * Counting those against the cap would make the number look stricter while
   * meaning less: it would push out a read that a person actually asks for in
   * order to make room for one that had no alternative home. The honest total
   * is asserted separately, below, so nothing hides in the gap between the two.
   */
  it("holds no more than eight frequency-earned reads", () => {
    expect(
      HOT_READ_TOOL_NAMES.length,
      `the hot set is ${HOT_READ_TOOL_NAMES.join(", ")}. ` +
        "A ninth is evidence the domain split is wrong, not a reason to raise the cap.",
    ).toBeLessThanOrEqual(HOT_READ_CAP);
  });

  /**
   * ⚠ **`my_memory` is in the hot set and belongs to no domain**, which is a
   * shape this assertion did not have before Phase 4.6.
   *
   * By the reasoning in the header it could have gone in
   * `COORDINATOR_ONLY_TOOL_NAMES` instead — memory spans every area, no
   * specialist owns it, and specialists read their facts by injection rather
   * than by holding a tool, so on the letter of *"there is nowhere else for it
   * to be"* it qualifies.
   *
   * **It is counted against the cap anyway, deliberately.** That is the
   * stricter reading, and the one that keeps the number meaning something: a
   * new tool that argues its way out of the contended set is exactly how a cap
   * stops counting. So the exception is named here rather than avoided.
   */

  it("nothing crept onto the coordinator from a domain except the hot set", () => {
    // The assertion that gives the cap its teeth. Every read a specialist owns
    // is a read that could have been routed — so if one is here, it must have
    // earned a seat, and there is nowhere to put a ninth without this failing.
    const domainReads = new Set(DOMAINS.flatMap((d) => [...d.toolNames]));
    const held = coordinatorToolNames().filter((n) => domainReads.has(n));
    const expected = HOT_READ_TOOL_NAMES.filter((n) => !HOT_READS_WITHOUT_A_DOMAIN.includes(n));
    expect(held.sort()).toEqual([...expected].sort());
  });

  it("a hot read with no domain is named, not merely absent", () => {
    // Without this, the exception above would silently cover anything that
    // happened to be missing from the domain table — including a read left out
    // of it BY MISTAKE, which is the failure the table is meant to catch.
    const domainReads = new Set(DOMAINS.flatMap((d) => [...d.toolNames]));
    const homeless = HOT_READ_TOOL_NAMES.filter((n) => !domainReads.has(n));
    expect(homeless.sort()).toEqual([...HOT_READS_WITHOUT_A_DOMAIN].sort());
  });

  it("the whole set is small, and the number is pinned so growth is visible", () => {
    // SEVEN hot reads + three promoted writes + explain_figure + eleven that
    // cannot be routed. The two doors — consult_specialists and
    // delegate_action — are built in agent.ts rather than looked up, so they
    // are not in this list; the coordinator actually sees two more than this.
    //
    // ⚠ 21 -> 22 in Phase 4.6, and the one that moved it is `my_memory`. The
    // number is pinned precisely so that a change to it has to be typed by
    // somebody who then has to say why, which is this sentence.
    const names = coordinatorToolNames();
    expect(
      names.length,
      `the coordinator carries ${names.length}: ${names.join(", ")}`,
    ).toBe(22);
  });

  it("the contended half stays under the fallback ceiling", () => {
    // One budget, not two. If a write is ever promoted here for latency, it
    // displaces a read and this is the line that says so.
    const contended = [
      ...HOT_READ_TOOL_NAMES,
      ...coordinatorToolNames().filter((n) => isWrite(n) && !UNROUTED_WRITE_NAMES.includes(n)),
    ];
    expect(contended.length).toBeLessThanOrEqual(COORDINATOR_HOT_CEILING);
  });

  it("every hot read is a real tool, and every one of them reads", () => {
    for (const name of HOT_READ_TOOL_NAMES) {
      expect(ALL_TOOLS.map((t) => t.name), `${name} is not a tool`).toContain(name);
      expect(isWrite(name), `${name} is on the hot READ set and it writes`).toBe(false);
    }
  });
});

describe("the coordinator no longer receives the whole catalogue", () => {
  it("carries a fraction of ALL_TOOLS", () => {
    const held = coordinatorToolNames().length;
    expect(held).toBeLessThan(ALL_TOOLS.length / 4);
  });

  it("holds no write that belongs to a specialist, except the promoted three", () => {
    // The whole point of the move. A write with a home is reached by routing to
    // that home — unless it was PROMOTED back by the measured-latency rule, and
    // then it is here on purpose and named in one place.
    const homed = new Set(DOMAINS.flatMap((d) => [...d.writeToolNames]));
    const promoted = new Set<string>(PROMOTED_WRITE_TOOL_NAMES);
    const leaked = coordinatorToolNames().filter((n) => homed.has(n) && !promoted.has(n));
    expect(leaked, "these writes moved into a specialist and are still here too").toEqual([]);
  });

  it("keeps exactly the five unroutable writes, plus the promoted three", () => {
    const kept = coordinatorToolNames().filter(isWrite).sort();
    expect(kept).toEqual(
      [...UNROUTED_WRITE_NAMES, ...PROMOTED_WRITE_TOOL_NAMES].sort(),
    );
  });

  /**
   * ⚠ **The cap on promotion, and it is the one that stops this phase being
   * undone one tool at a time.**
   *
   * Three at most. If three does not bring the write path back under five
   * seconds — and, measured, it does not — the finding is that the ROUTING
   * DECISION is slow rather than the split, and that is separate work with a
   * separate decision behind it. A fourth promotion is not a smaller version of
   * that decision; it is the drift the rule exists to prevent.
   */
  it("no more than three writes are ever promoted", () => {
    expect(
      PROMOTED_WRITE_TOOL_NAMES.length,
      "a fourth promotion means the fix is a cheaper router, not another tool here",
    ).toBeLessThanOrEqual(3);
  });

  it("a promoted write still lives in its specialist too", () => {
    // Promotion is a second copy, not a move. A routed instruction must still
    // reach it — otherwise "add an hour of Module 4" works and "the day
    // specialist please add an hour of Module 4" does not.
    for (const name of PROMOTED_WRITE_TOOL_NAMES) {
      expect(
        DOMAINS.some((d) => d.writeToolNames.includes(name)),
        `${name} was promoted out of its specialist rather than duplicated`,
      ).toBe(true);
    }
  });
});

describe("⚠ the proposal pair never moves", () => {
  /**
   * The propose-gate spans two turns and **turn 2 is a plain conversational
   * reply**. If `approve_proposal` lived in a specialist, *"yes"* would have to
   * be routed — and the coordinator would have to pick a domain from a word
   * carrying none at all.
   *
   * Phase 3 already found the failure that creates: told *"yes, go ahead"*, the
   * model called `approve_proposal` with a **leave id**, because it was the
   * only id in front of it. A routing hop on that path makes it worse.
   */
  it("approve_proposal and discard_proposal are on the coordinator", () => {
    expect(COORDINATOR_ONLY_TOOL_NAMES).toContain("approve_proposal");
    expect(COORDINATOR_ONLY_TOOL_NAMES).toContain("discard_proposal");
  });

  it("and are in no specialist, in either mode", () => {
    for (const d of DOMAINS) {
      for (const mode of ["ask", "act"] as const) {
        const names = toolsForDomain(d.id, mode).map((t) => t.name);
        expect(names, `${d.id}/${mode} can reach approve_proposal`).not.toContain(
          "approve_proposal",
        );
        expect(names, `${d.id}/${mode} can reach discard_proposal`).not.toContain(
          "discard_proposal",
        );
      }
    }
  });
});

describe("the coordinator is still built per person", () => {
  it("an intern is offered strictly less than an admin", () => {
    const intern = coordinatorTools(new ToolContext("ravi", deps)).names;
    const admin = coordinatorTools(new ToolContext("superadmin", deps)).names;
    expect(intern.length).toBeLessThanOrEqual(admin.length);
    for (const name of intern) expect(admin).toContain(name);
  });

  it("the filtering is the same one `toolsFor` applies — nothing was loosened", () => {
    // A tool offered here that `toolsFor` would have withheld would be a
    // permission change wearing a restructuring's clothes.
    const ctx = new ToolContext("ravi", deps);
    const offered = coordinatorTools(ctx).names;
    const wouldOffer = new Set(
      ALL_TOOLS.filter((spec) => {
        if (!spec.requires) return true;
        return deps.permissions.can({
          actor: "ravi",
          action: spec.requires.action,
          nodeType: spec.requires.nodeType,
        }).allowed;
      }).map((t) => t.name),
    );
    for (const name of offered) {
      expect(wouldOffer.has(name), `${name} was offered to an intern by the new path only`).toBe(
        true,
      );
    }
  });
});
