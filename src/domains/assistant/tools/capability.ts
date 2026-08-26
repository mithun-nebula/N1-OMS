import { tool } from "ai";
import { z } from "zod";
import { directory } from "@/server/directory";
import type { ToolSpec } from "./catalogue";
import { shape, visible } from "./shape";

/**
 * The two tools that **derive** rather than retrieve — and the only two written
 * to a different shape because of it.
 *
 * ── Why they were held back from 1a ─────────────────────────────────────────
 *
 * 1a's one real defect was the model answering *"August 11–17, 2025"* to a
 * question about next week: a range it computed, stated in exactly the tone it
 * used for facts it had actually read. The conclusion was even right. What was
 * wrong was invisible, because nothing in the answer distinguished the part it
 * looked up from the part it worked out.
 *
 * These two tools compute a judgement — who is best placed, where the
 * organisation is thin. If they returned `{ best: "priya" }`, the model would
 * repeat "Priya is best placed" with the same confidence it uses for "Priya's
 * contact is priya@orga.example", and a reader would have no way to tell that
 * one was retrieved and the other inferred from three numbers and a sort order.
 *
 * ── So: evidence, not a verdict ─────────────────────────────────────────────
 *
 * They return the counts they ordered on, the rule they ordered by, and the
 * date the numbers are true as of. An ordering still comes back — refusing to
 * order would just move the arithmetic into the model, which is worse — but it
 * comes back **with its workings**, so a wrong answer is checkable rather than
 * merely wrong.
 *
 * ── Why the field is `orderedBy` and not `rankedOn` ─────────────────────────
 *
 * The plan specified `rankedOn`. Asked for real, the whole answer came back as
 * *"I can only comment on your work, not on you."* — `sanitizeForAppendixD`
 * blocks `/ranked/i` as a comparison, and the model had echoed the field
 * name. Appendix D is a non-negotiable and is not weakened to suit a tool, so
 * the tool uses a word that does not collide.
 *
 * The deeper tension is real and is NOT resolved here: appendix D says never
 * compare people, and `who_is_best` compares people. The distinction the
 * denylist cannot draw is between comparing *workload counts* (a work fact) and
 * comparing *people* (a judgement about them). That is a product decision.
 *
 * The measure of success here is not accuracy. It is whether a person reading
 * the answer can tell it is an inference.
 */

interface Candidate {
  person: string;
  name: string;
  ownsCourses: number;
  ownsStages: number;
  completedStages: number;
  openTasks: number;
}

/**
 * Everyone the actor can see, with the numbers a capability question turns on.
 *
 * Built from the same permission-bound reads every other tool uses, so a person
 * who cannot see a course does not get to compare the people on it either.
 */
async function gatherCandidates(
  ctx: Parameters<ToolSpec["build"]>[0],
  opts: { team?: string } = {},
): Promise<{ candidates: Candidate[]; courseCount: number }> {
  const dir = directory();

  const people = await ctx.deps.spine.readMany({
    actor: ctx.actor,
    nodeType: "employee",
    filter: (data) => {
      const d = data as { status?: string; team?: string };
      if (d.status && d.status !== "active") return false;
      if (opts.team && (d.team ?? "").toLowerCase() !== opts.team.toLowerCase()) return false;
      return true;
    },
  });
  const courses = await ctx.deps.spine.readMany({ actor: ctx.actor, nodeType: "course" });
  const tasks = await ctx.deps.spine.readMany({
    actor: ctx.actor,
    nodeType: "task",
    filter: (data) => (data as { status?: string }).status !== "done",
  });

  ctx.noteAll("employee", people.map((p) => p.nodeId));
  ctx.noteAll("course", courses.map((c) => c.nodeId));

  const openTaskCount = new Map<string, number>();
  for (const t of tasks) {
    const who = visible(t.record.assignedTo) as string | undefined;
    if (who) openTaskCount.set(who, (openTaskCount.get(who) ?? 0) + 1);
  }

  const owns = new Map<string, number>();
  const stageOwn = new Map<string, number>();
  const stageDone = new Map<string, number>();
  for (const c of courses) {
    const owner = visible(c.record.owner) as string | undefined;
    if (owner) owns.set(owner, (owns.get(owner) ?? 0) + 1);

    const stageOwners =
      (visible(c.record.stageOwners) as Record<string, string> | undefined) ?? {};
    const stage = String(visible(c.record.stage) ?? "");
    for (const [stageName, who] of Object.entries(stageOwners)) {
      if (!who) continue;
      stageOwn.set(who, (stageOwn.get(who) ?? 0) + 1);
      // A stage earlier in the pipeline than the course's current one has been
      // got through. Crude, and stated as such in `orderedBy`.
      if (stageName !== stage) stageDone.set(who, (stageDone.get(who) ?? 0) + 1);
    }
  }

  const candidates: Candidate[] = people.map((p) => ({
    person: p.nodeId,
    name: dir.nameOf(p.nodeId),
    ownsCourses: owns.get(p.nodeId) ?? 0,
    ownsStages: stageOwn.get(p.nodeId) ?? 0,
    completedStages: stageDone.get(p.nodeId) ?? 0,
    openTasks: openTaskCount.get(p.nodeId) ?? 0,
  }));

  return { candidates, courseCount: courses.length };
}

export const whoIsBest: ToolSpec = {
  name: "who_is_best",
  requires: { action: "view", nodeType: "employee" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT tell you who exists or how to reach them — for the directory, use find_people. It does not return anybody's pay, performance rating or any assessment of them as a person; there is no such data here and none can be inferred from what it does return.",
        "For where the organisation depends on one person — the opposite question — use capability_gaps.",
        "",
        "Who is best placed to take on a piece of work, WITH THE NUMBERS BEHIND IT.",
        'Use for "who should build this course", "who has capacity", "who could take this on", "who has done this kind of thing before".',
        "Returns a list of candidates with, for each: how many courses they own, how many stages they own, how many stages they have got through, and how many tasks they currently have open. It also returns the rule it ordered by and the date the numbers are true as of.",
        "",
        "IMPORTANT — this is an INFERENCE, not a record. Nobody has written down who is best at anything. The ordering is arithmetic over workload and experience counts, so present it as a suggestion supported by those numbers, and quote the numbers. Do not state it as a fact about a person.",
      ].join("\n"),
      inputSchema: z.object({
        team: z.string().optional().describe("Only consider people on this team."),
        limit: z.number().optional().describe("How many candidates. Defaults to a handful."),
      }),
      execute: async ({ team, limit }) => {
        const { candidates } = await gatherCandidates(ctx, { team });
        if (candidates.length === 0) {
          return {
            candidates: [],
            note: "Nobody visible to compare. Say so rather than suggesting anyone.",
            asOf: ctx.deps.today(),
          };
        }
        // Most experience first, then least loaded. Stated in `orderedBy` so the
        // ordering is arguable rather than authoritative.
        const ordered = [...candidates].sort(
          (a, b) => b.completedStages - a.completedStages || a.openTasks - b.openTasks,
        );
        return {
          ...shape(ordered, (c) => c, { cap: limit && limit > 0 ? limit : 6 }),
          orderedBy: "completedStages desc, then openTasks asc",
          basis:
            "Counted from course ownership, stage ownership and open tasks. There is no record of skill or performance, and none is used.",
          asOf: ctx.deps.today(),
        };
      },
    }),
};

export const capabilityGaps: ToolSpec = {
  name: "capability_gaps",
  requires: { action: "view", nodeType: "course" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT list who is on a particular course — for that, use course_assignees. It does not say who is best placed to take work on either; that is the opposite question, and it is who_is_best.",
        "",
        "Where the organisation depends on ONE person, WITH THE NUMBERS BEHIND IT.",
        'Use for "where are we thin", "what has a single point of failure", "who is a bus factor", "what would we struggle to cover".',
        "Returns, per course at risk: its title, who owns it, how many other people touch it at all, and why it was flagged. Also returns how many courses were examined and the date the numbers are true as of.",
        "",
        "IMPORTANT — this is an INFERENCE, not a record. Nothing here records risk; it is counted from ownership. Present it as what the counts show, and quote them.",
      ].join("\n"),
      inputSchema: z.object({
        team: z.string().optional().describe("Only consider courses owned within this team."),
      }),
      execute: async ({ team }) => {
        const dir = directory();
        const courses = await ctx.deps.spine.readMany({ actor: ctx.actor, nodeType: "course" });
        const tasks = await ctx.deps.spine.readMany({ actor: ctx.actor, nodeType: "task" });
        ctx.noteAll("course", courses.map((c) => c.nodeId));

        const touchedBy = new Map<string, Set<string>>();
        for (const t of tasks) {
          const courseId = visible(t.record.courseId) as string | undefined;
          const who = visible(t.record.assignedTo) as string | undefined;
          if (!courseId || !who) continue;
          const set = touchedBy.get(courseId) ?? new Set<string>();
          set.add(who);
          touchedBy.set(courseId, set);
        }

        const rows = courses
          .map((c) => {
            const owner = visible(c.record.owner) as string | undefined;
            const others = new Set(touchedBy.get(c.nodeId) ?? []);
            if (owner) others.delete(owner);
            return {
              id: c.nodeId,
              title: visible(c.record.title),
              owner: owner ? { id: owner, name: dir.nameOf(owner) } : undefined,
              ownerTeam: owner ? dir.teamNameOf(owner) : undefined,
              othersInvolved: others.size,
              flaggedBecause:
                others.size === 0
                  ? owner
                    ? "one owner and nobody else assigned to it"
                    : "no owner recorded at all"
                  : undefined,
            };
          })
          .filter((r) => (team ? (r.ownerTeam ?? "").toLowerCase() === team.toLowerCase() : true))
          .filter((r) => r.othersInvolved === 0);

        return {
          ...shape(rows, (r) => r),
          coursesExamined: courses.length,
          orderedBy: "courses where nobody but the owner is assigned",
          basis:
            "Counted from course ownership and task assignment. Nothing records risk directly; this is what the counts show.",
          asOf: ctx.deps.today(),
        };
      },
    }),
};

export const capabilityTools: ToolSpec[] = [whoIsBest, capabilityGaps];
