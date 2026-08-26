import { tool } from "ai";
import { z } from "zod";
import { directory } from "@/server/directory";
import { attendanceOwner } from "@/domains/people/attendance";
import type { OnboardingStep } from "@/domains/people/joining";
import type { HandoverItem } from "@/domains/people/leaving";
import type { ToolSpec } from "./catalogue";
import { shape, safeFields, visible } from "./shape";
import { PERIODS, resolveWindow, withinWindow } from "./window";

/**
 * People and leave — and the two sibling pairs this stage exists to learn from.
 *
 * `find_people` / `get_person` and `list_leave` / `leave_balance` are each
 * trivially confusable, and a model that picks the wrong one answers a question
 * nobody asked with data that looks right. Every description below therefore
 * ends by **pointing away from itself**, in both directions. That sentence is
 * the whole trick; the rest of a description is bookkeeping.
 */

const EMPLOYEE_FIELDS = [
  "name",
  "role",
  "team",
  "contact",
  "status",
  "designationId",
  "departmentId",
  "managerId",
] as const;

export const findPeople: ToolSpec = {
  name: "find_people",
  requires: { action: "view", nodeType: "employee" },
  build: (ctx) =>
    tool({
      description: [
        "Search for people across the organisation, or list a whole team.",
        'Use for "who is in the courses team", "find everyone who reports to James", "how many people are there", or any question about MORE THAN ONE person.',
        "Returns, for each match: name, role, team, contact, and whether they are active.",
        "",
        "For everything known about ONE named person, use get_person instead — it returns more about them, including who they report to.",
        "For who is best placed to TAKE ON a piece of work, rather than who exists, use who_is_best.",
      ].join("\n"),
      inputSchema: z.object({
        team: z.string().optional().describe("Restrict to one team, e.g. courses."),
        nameContains: z.string().optional().describe("Match part of a name."),
        reportsTo: z.string().optional().describe("Only people whose manager is this employee id."),
        activeOnly: z
          .boolean()
          .optional()
          .describe("Leave out people who have left. Defaults to true."),
      }),
      execute: async ({ team, nameContains, reportsTo, activeOnly = true }) => {
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "employee",
          filter: (data) => {
            const d = data as {
              name?: string;
              team?: string;
              managerId?: string;
              status?: string;
            };
            if (activeOnly && d.status && d.status !== "active") return false;
            if (team && (d.team ?? "").toLowerCase() !== team.toLowerCase()) return false;
            if (reportsTo && d.managerId !== reportsTo) return false;
            if (
              nameContains &&
              !(d.name ?? "").toLowerCase().includes(nameContains.toLowerCase())
            ) {
              return false;
            }
            return true;
          },
        });
        ctx.noteAll(
          "employee",
          rows.map((r) => r.nodeId),
        );
        return shape(rows, (r) => ({
          id: r.nodeId,
          ...safeFields(r.record, [...EMPLOYEE_FIELDS]),
        }));
      },
    }),
};

export const getPerson: ToolSpec = {
  name: "get_person",
  requires: { action: "view", nodeType: "employee" },
  build: (ctx) =>
    tool({
      description: [
        "Everything visible about ONE person, found by their id or their name.",
        'Use for "who is Priya", "what is Arun\'s role", "who does Ravi report to", or any question about a single named individual.',
        "Returns their name, role, team, contact, status, who they report to, and who reports to them.",
        "",
        'To find SEVERAL people, or when you do not already have a name — "everyone in the courses team", "who reports to James" — use find_people instead.',
        "For how many days of leave they have left, use leave_balance.",
      ].join("\n"),
      inputSchema: z.object({
        person: z
          .string()
          .describe("The person's id (e.g. priya) or their name (e.g. Priya R.)."),
      }),
      execute: async ({ person }) => {
        const dir = directory();
        // A name is what a person would say; an id is what the records use.
        const id = dir.get(person) ? person : dir.findByName(person)?.id;
        if (!id) return { found: false, note: `No person matching "${person}".` };

        const result = await ctx.deps.spine.read({
          actor: ctx.actor,
          nodeType: "employee",
          nodeId: id,
        });
        // `found: false` covers both "no such person" and "not yours to see".
        // The gate deliberately does not distinguish them, and neither does this.
        if (!result.found) return { found: false, note: `No person matching "${person}".` };
        ctx.note("employee", id);

        const manager = dir.managerOf(id);
        const reports = dir.reportsOf(id);
        return {
          found: true,
          person: {
            id,
            ...safeFields(result.record, [...EMPLOYEE_FIELDS]),
            reportsTo: manager ? { id: manager, name: dir.nameOf(manager) } : undefined,
            directReports: reports.map((r) => ({ id: r, name: dir.nameOf(r) })),
          },
        };
      },
    }),
};

export const listLeave: ToolSpec = {
  name: "list_leave",
  requires: { action: "view", nodeType: "leave" },
  build: (ctx) =>
    tool({
      description: [
        "List leave REQUESTS — individual bookings of time off.",
        'Use for "who is off next week", "whose leave needs my approval", "has Priya booked anything", or leave falling in a date range.',
        "Returns, for each request: whose it is, the from and to dates (YYYY-MM-DD), the type, and the status (pending, approved or declined).",
        "",
        "For how many days somebody has LEFT to take, use leave_balance instead — that is a single number, and this tool does not return it.",
        "For whether somebody was actually PRESENT on a day — clocked in, hours worked — use attendance instead. Booked leave and recorded absence are different records: somebody can be absent without leave, or on approved leave they never took.",
      ].join("\n"),
      inputSchema: z.object({
        person: z.string().optional().describe("Only this person's leave, by employee id."),
        from: z
          .string()
          .optional()
          .describe("Only leave ending on or after this date, YYYY-MM-DD."),
        to: z
          .string()
          .optional()
          .describe("Only leave starting on or before this date, YYYY-MM-DD."),
        status: z.enum(["pending", "approved", "declined"]).optional(),
      }),
      execute: async ({ person, from, to, status }) => {
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "leave",
          filter: (data) => {
            const d = data as {
              employeeId?: string;
              fromDate?: string;
              toDate?: string;
              status?: string;
            };
            if (person && d.employeeId !== person) return false;
            // ⚠ The stored status is capitalised — "Pending", "Approved",
            // "Declined" — and this schema offers lower case. Compared
            // directly, `status: "pending"` matched NOTHING, so "whose leave
            // needs my approval" always answered "none", for everybody, for as
            // long as this tool has existed.
            //
            // Found by running Phase 3 for real against a seeded database, not
            // by any test: every test that exercised this called it without a
            // status. Compared case-insensitively now.
            if (status && String(d.status ?? "").toLowerCase() !== status) return false;
            // Overlap, not containment: leave spanning the window counts.
            if (from && (d.toDate ?? d.fromDate ?? "") < from) return false;
            if (to && (d.fromDate ?? "") > to) return false;
            return true;
          },
        });
        ctx.noteAll(
          "leave",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        return shape(rows, (r) => {
          const employeeId = visible(r.record.employeeId) as string | undefined;
          return {
            id: r.nodeId,
            employeeId,
            who: employeeId ? dir.nameOf(employeeId) : undefined,
            ...safeFields(r.record, ["fromDate", "toDate", "type", "status", "days"]),
          };
        });
      },
    }),
};

export const leaveBalance: ToolSpec = {
  name: "leave_balance",
  requires: { action: "view", nodeType: "employee" },
  build: (ctx) =>
    tool({
      description: [
        "How many days of leave somebody has LEFT to take. A single number.",
        'Use for "how much leave do I have", "how many days does Priya have left", "can I take a week off".',
        "Returns one balance, in days, for one person. Called with no argument it answers for the person asking.",
        "",
        "For the bookings themselves — who is off, on which dates, what still needs approving — use list_leave instead. This tool returns no dates at all.",
      ].join("\n"),
      inputSchema: z.object({
        person: z.string().optional().describe("Employee id. Omit for the person asking."),
      }),
      execute: async ({ person }) => {
        const id = person ?? ctx.actor;
        const result = await ctx.deps.spine.read({
          actor: ctx.actor,
          nodeType: "employee",
          nodeId: id,
        });
        if (!result.found) return { found: false, note: `No leave balance visible for "${id}".` };
        ctx.note("employee", id);
        const balance = visible(result.record.leaveBalance);
        if (typeof balance !== "number") {
          // Masked or absent — say nothing that implies a number exists.
          return { found: false, note: `No leave balance visible for "${id}".` };
        }
        return { found: true, person: id, name: directory().nameOf(id), balanceDays: balance };
      },
    }),
};


export const attendance: ToolSpec = {
  name: "attendance",
  requires: { action: "view", nodeType: "attendance" },
  build: (ctx) =>
    tool({
      description: [
        // The negative clause first — rule 1 from 1a's learning log.
        "This tool does NOT show booked time off. For leave requests — who is off, on which dates, what needs approving — use list_leave instead. Being ABSENT and being ON LEAVE are different records, and somebody can be either without the other.",
        "It also does not show what somebody planned to work on; for that use my_day.",
        "",
        "Whether somebody was PRESENT, and when they clocked in and out.",
        'Use for "was Priya in on Tuesday", "how many hours did I work last week", "who has not clocked in", "what time did they start".',
        "Returns, per day: the date (YYYY-MM-DD), the clock-in and clock-out times, and the minutes worked.",
        "Also returns the exact window it looked at, so the dates in your answer can be checked against it.",
        "Always name a period rather than working dates out yourself — this tool resolves it and returns the exact window it used. State those dates.",
      ].join("\n"),
      inputSchema: z.object({
        person: z
          .string()
          .optional()
          .describe("Employee id. Omit for the person asking."),
        period: z
          .enum(PERIODS)
          .optional()
          .describe("A named period. Do NOT work dates out yourself — name the period and this resolves it."),
        from: z.string().optional().describe("Explicit start, YYYY-MM-DD. Overrides period."),
        to: z.string().optional().describe("Explicit end, YYYY-MM-DD. Overrides period."),
      }),
      execute: async ({ person, period, from, to }) => {
        const id = person ?? ctx.actor;
        const window = resolveWindow(ctx.deps.today(), { period, from, to });

        // The opaque check first: somebody who may not know this person exists
        // must not learn it from an empty attendance list (non-negotiable #2).
        const who = await ctx.deps.spine.read({
          actor: ctx.actor,
          nodeType: "employee",
          nodeId: id,
        });
        if (!who.found) {
          return { found: false, window, note: `No attendance visible for "${id}".` };
        }

        // ── The filter that closed a real leak ──────────────────────────────
        //
        // `/api/people/[id]/attendance` used to check `view` on the EMPLOYEE
        // and then return attendance straight from the graph. Employees hold
        // `own-team` on employee while attendance is scoped to `self`, so the
        // permissive check ran and any employee could read a colleague's whole
        // attendance history. Phase 0 fixed it by filtering on the ownership
        // encoded in the id. That path is reused here verbatim rather than
        // re-derived — `readMany` then re-checks record scope per row, so this
        // narrows the set and the gate still decides.
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "attendance",
          filter: (data, nodeId) => {
            if (attendanceOwner(String(nodeId)) !== id) return false;
            return withinWindow((data as { date?: string }).date, window);
          },
        });
        ctx.noteAll(
          "attendance",
          rows.map((r) => r.nodeId),
        );

        const shaped = shape(
          [...rows].sort((a, b) =>
            String(a.record.date ?? "").localeCompare(String(b.record.date ?? "")),
          ),
          (r) => ({
            id: r.nodeId,
            ...safeFields(r.record, ["date", "checkInAt", "checkOutAt", "workedMinutes"]),
          }),
        );
        return {
          found: true,
          person: id,
          name: directory().nameOf(id),
          // The ground truth, returned with the data. See `window.ts`.
          window,
          ...shaped,
        };
      },
    }),
};

export const joiningStatus: ToolSpec = {
  name: "joining_status",
  requires: { action: "view", nodeType: "onboarding" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT return tasks from the board — onboarding steps look like tasks and are not tasks, so list_tasks will not find them and this will not find anything on the board.",
        "For somebody LEAVING rather than arriving, use handover_status. These two are mirror images and are easy to reach for by mistake.",
        "",
        "How far a NEW STARTER has got through joining.",
        'Use for "where are we with the new starter", "what is left for Ravi to join", "is anyone\'s onboarding overdue", "has their induction finished".',
        "Returns, per person joining: when they started, whether onboarding is active or complete, and each step with its owner, due date and whether it is done.",
      ].join("\n"),
      inputSchema: z.object({
        person: z.string().optional().describe("Employee id. Omit for everyone still joining."),
        pendingOnly: z
          .boolean()
          .optional()
          .describe("Only steps not yet done. Use for 'what is left'."),
      }),
      execute: async ({ person, pendingOnly }) => {
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "onboarding",
          filter: (data) =>
            !person || (data as { employeeId?: string }).employeeId === person,
        });
        ctx.noteAll(
          "onboarding",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        return shape(rows, (r) => {
          const employeeId = visible(r.record.employeeId) as string | undefined;
          const steps = (visible(r.record.steps) as OnboardingStep[] | undefined) ?? [];
          const chosen = pendingOnly ? steps.filter((s) => s.status !== "done") : steps;
          return {
            id: r.nodeId,
            employeeId,
            who: employeeId ? dir.nameOf(employeeId) : undefined,
            ...safeFields(r.record, ["startedAt", "status"]),
            stepsPending: steps.filter((s) => s.status !== "done").length,
            stepsTotal: steps.length,
            steps: chosen.map((s) => ({
              title: s.title,
              owner: s.owner ? dir.nameOf(s.owner) : undefined,
              dueAt: s.dueAt,
              done: s.status === "done",
            })),
          };
        });
      },
    }),
};

export const handoverStatus: ToolSpec = {
  name: "handover_status",
  requires: { action: "view", nodeType: "offboarding" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT return tasks from the board — a handover item looks like a task and is not one, so list_tasks will not find them.",
        "For somebody ARRIVING rather than leaving, use joining_status. These two are mirror images and are easy to reach for by mistake.",
        "",
        "What somebody LEAVING still has to hand over.",
        'Use for "what does the leaver still owe", "has the handover finished", "what is Priya passing on", "can we close their leaving off".',
        "Returns, per person leaving: their separation date, whether the handover is active or complete, whether they have actually been separated, and each item being passed on — what it is, to whom, and whether it is done.",
      ].join("\n"),
      inputSchema: z.object({
        person: z.string().optional().describe("Employee id. Omit for everyone leaving."),
        pendingOnly: z
          .boolean()
          .optional()
          .describe("Only items not yet handed over. Use for 'what is left'."),
      }),
      execute: async ({ person, pendingOnly }) => {
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "offboarding",
          filter: (data) =>
            !person || (data as { employeeId?: string }).employeeId === person,
        });
        ctx.noteAll(
          "offboarding",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        return shape(rows, (r) => {
          const employeeId = visible(r.record.employeeId) as string | undefined;
          const items = (visible(r.record.handovers) as HandoverItem[] | undefined) ?? [];
          const chosen = pendingOnly ? items.filter((h) => h.status !== "done") : items;
          return {
            id: r.nodeId,
            employeeId,
            who: employeeId ? dir.nameOf(employeeId) : undefined,
            ...safeFields(r.record, ["separationDate", "status", "separated"]),
            itemsPending: items.filter((h) => h.status !== "done").length,
            itemsTotal: items.length,
            handovers: chosen.map((h) => ({
              what: h.title,
              kind: h.type,
              to: h.to ? dir.nameOf(h.to) : undefined,
              done: h.status === "done",
            })),
          };
        });
      },
    }),
};

export const peopleTools: ToolSpec[] = [
  findPeople,
  getPerson,
  listLeave,
  leaveBalance,
  attendance,
  joiningStatus,
  handoverStatus,
];
