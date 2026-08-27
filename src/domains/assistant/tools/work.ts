import { tool } from "ai";
import { z } from "zod";
import { directory } from "@/server/directory";
import type { ToolSpec } from "./catalogue";
import { shape, safeFields, visible } from "./shape";
import { isInTheMeeting } from "@/domains/workplace/meeting-access";

/**
 * Courses, the work hanging off them, and what is in the diary.
 *
 * Same description discipline as `people.ts`: what it is for, what comes back,
 * and where to go instead. `course_progress` and `course_assignees` are not
 * quite siblings — one is about state, the other about people — but they are
 * asked about in the same breath, so each names the other anyway.
 */

export const courseProgress: ToolSpec = {
  name: "course_progress",
  requires: { action: "view", nodeType: "course" },
  build: (ctx) =>
    tool({
      description: [
        "How every course is doing: what stage it is at, how complete it is, and whether it has gone stale.",
        'Use for "which courses are behind", "how is AI Basics going", "what is stuck in review", "what percentage is done".',
        "Returns, per course: title, stage, completion percentage, whether it is stale, and how many days it has been waiting.",
        "",
        "For WHO is working on a course, use course_assignees instead — this tool returns no people.",
        "For ONE course in full — its modules, its owner, its progress note — use get_course. This tool summarises many and returns none of that detail.",
        "For what a completion percentage is MADE OF — \"why is that 60%\" — use explain_figure.",
      ].join("\n"),
      inputSchema: z.object({
        staleOnly: z
          .boolean()
          .optional()
          .describe("Only courses that have sat in one stage too long. Use for 'what is behind'."),
        stage: z.string().optional().describe("Only courses at this stage, e.g. review."),
      }),
      execute: async ({ staleOnly, stage }) => {
        const all = await ctx.deps.courses.listProgress(`${ctx.deps.today()}T23:59:59Z`);
        // The course service reads the graph directly, so the visibility check
        // that every other tool gets from `readMany` has to be done here.
        const visibleCourses = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "course",
        });
        const allowed = new Set(visibleCourses.map((r) => r.nodeId));
        const rows = all.filter((c) => {
          if (!allowed.has(c.id)) return false;
          if (staleOnly && !c.stale) return false;
          if (stage && c.stage !== stage) return false;
          return true;
        });
        ctx.noteAll(
          "course",
          rows.map((r) => r.id),
        );
        return shape(rows, (c) => ({
          id: c.id,
          title: c.title,
          stage: c.stage,
          completionPercent: c.completion?.value,
          stale: c.stale,
          daysWaiting: c.daysWaiting,
          owner: c.owner ? directory().nameOf(c.owner) : undefined,
        }));
      },
    }),
};

export const courseAssignees: ToolSpec = {
  name: "course_assignees",
  requires: { action: "view", nodeType: "course" },
  build: (ctx) =>
    tool({
      description: [
        "Who is working on a particular course.",
        'Use for "who is on AI Basics", "who is building the induction course", "is anyone working on this".',
        "Returns the course title, its owner, and the people assigned to it with the task each of them holds.",
        "",
        "For how far along a course is, use course_progress instead.",
        "For the course itself — modules, stage, owner — use get_course.",
        "For someone's whole workload across everything, use list_tasks.",
        "For where the organisation depends on a single person across ALL courses, use capability_gaps.",
      ].join("\n"),
      inputSchema: z.object({
        course: z.string().describe("The course id or its title."),
      }),
      execute: async ({ course }) => {
        const courses = await ctx.deps.spine.readMany({ actor: ctx.actor, nodeType: "course" });
        const match =
          courses.find((c) => c.nodeId === course) ??
          courses.find(
            (c) => String(c.record.title ?? "").toLowerCase() === course.toLowerCase(),
          ) ??
          courses.find((c) =>
            String(c.record.title ?? "")
              .toLowerCase()
              .includes(course.toLowerCase()),
          );
        if (!match) return { found: false, note: `No course matching "${course}".` };
        ctx.note("course", match.nodeId);

        // The course→task link is a FIELD on the task, one direction, with no
        // edge behind it. That is an implementation quirk, so it stays in here
        // rather than becoming something the model has to know.
        const tasks = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "task",
          filter: (data) => (data as { courseId?: string }).courseId === match.nodeId,
        });
        ctx.noteAll(
          "task",
          tasks.map((t) => t.nodeId),
        );

        const dir = directory();
        const owner = visible(match.record.owner) as string | undefined;
        return {
          found: true,
          course: { id: match.nodeId, title: visible(match.record.title) },
          owner: owner ? { id: owner, name: dir.nameOf(owner) } : undefined,
          assignees: tasks.map((t) => {
            const who = visible(t.record.assignedTo) as string | undefined;
            return {
              id: who,
              name: who ? dir.nameOf(who) : undefined,
              task: visible(t.record.title),
              status: visible(t.record.status),
            };
          }),
        };
      },
    }),
};

export const listTasks: ToolSpec = {
  name: "list_tasks",
  requires: { action: "view", nodeType: "task" },
  build: (ctx) =>
    tool({
      description: [
        "List tasks on the board — the work assigned to people.",
        'Use for "what is on my plate", "what is Priya working on", "what is overdue", "what is still to do".',
        "Returns, per task: title, who it is assigned to, status (todo, in-progress or done), priority, due date, and the course it belongs to if any.",
        "",
        "For ONE task you already have the id of, use get_task — it returns more about it than this list does.",
        "For what somebody committed to TODAY specifically, with times, use my_day instead.",
        "For the people on one course rather than their tasks, use course_assignees.",
      ].join("\n"),
      inputSchema: z.object({
        person: z.string().optional().describe("Only tasks assigned to this employee id."),
        status: z.enum(["todo", "in-progress", "done"]).optional(),
        courseId: z.string().optional().describe("Only tasks belonging to this course."),
        dueBefore: z.string().optional().describe("Only tasks due before this date, YYYY-MM-DD."),
      }),
      execute: async ({ person, status, courseId, dueBefore }) => {
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "task",
          filter: (data) => {
            const d = data as {
              assignedTo?: string;
              status?: string;
              courseId?: string;
              dueDate?: string;
            };
            if (person && d.assignedTo !== person) return false;
            if (status && d.status !== status) return false;
            if (courseId && d.courseId !== courseId) return false;
            if (dueBefore && (d.dueDate ?? "9999-99-99") >= dueBefore) return false;
            return true;
          },
        });
        ctx.noteAll(
          "task",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        return shape(rows, (r) => {
          const who = visible(r.record.assignedTo) as string | undefined;
          return {
            id: r.nodeId,
            assignedTo: who ? dir.nameOf(who) : undefined,
            ...safeFields(r.record, ["title", "status", "priority", "dueDate", "courseId"]),
          };
        });
      },
    }),
};

export const listMeetings: ToolSpec = {
  name: "list_meetings",
  requires: { action: "view", nodeType: "meeting" },
  build: (ctx) =>
    tool({
      description: [
        "List meetings in the diary.",
        'Use for "what meetings do I have", "what is on Thursday", "when is the review", "who is attending the standup".',
        "Returns, per meeting: title, start and end times (ISO timestamps), who is attending, whether it has been cancelled, the join link where there is one, and its KIND, which is one of three:",
        '  "in-person" — a room is booked for it, and there is no link.',
        '  "online"    — there is a join link, and no room.',
        '  "both"      — a room AND a link, so anyone who cannot come in can still join. This is the DEFAULT kind.',
        "",
        "For whether a ROOM is free, use room_availability instead.",
        "For ONE meeting in full — and above all for WHAT WAS DECIDED in it — use get_meeting. This tool returns titles and times, never decisions.",
        "For a question about a whole PERIOD rather than about meetings — \"what is on next week\", \"what is happening Thursday\" — use calendar_month, which covers events and calendar entries too.",
        "For organisation events, which are not meetings, use list_events.",
        "For today's committed work rather than the diary, use my_day.",
      ].join("\n"),
      inputSchema: z.object({
        person: z.string().optional().describe("Only meetings this employee id attends."),
        from: z.string().optional().describe("Only meetings starting on or after this date."),
        to: z.string().optional().describe("Only meetings starting on or before this date."),
        includeCancelled: z.boolean().optional().describe("Defaults to false."),
      }),
      execute: async ({ person, from, to, includeCancelled = false }) => {
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "meeting",
          filter: (data) => {
            const d = data as {
              attendees?: string[];
              from?: string;
              cancelled?: boolean;
            };
            if (!includeCancelled && d.cancelled === true) return false;
            if (person && !(d.attendees ?? []).includes(person)) return false;
            const day = (d.from ?? "").slice(0, 10);
            if (from && day < from) return false;
            if (to && day > to) return false;
            return true;
          },
        });
        ctx.noteAll(
          "meeting",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        return shape(rows, (r) => {
          const attendees = (visible(r.record.attendees) as string[] | undefined) ?? [];
          // `link` is here because a person asking about an online meeting
          // almost always wants to join it, and E7 requires the link to be
          // reachable rather than described. Absent on in-person meetings —
          // and absent for anybody NOT ON THIS MEETING, because the link is
          // the way into the room rather than a fact about it. The same rule
          // the screens apply; chat and voice must not be the softer door.
          const fields: string[] = ["title", "from", "to", "kind", "cancelled"];
          if (isInTheMeeting(ctx.actor, r.record)) fields.push("link");
          return {
            id: r.nodeId,
            ...safeFields(r.record, fields),
            attendees: attendees.map((a) => dir.nameOf(a)),
          };
        });
      },
    }),
};

export const roomAvailability: ToolSpec = {
  name: "room_availability",
  requires: { action: "view", nodeType: "room" },
  build: (ctx) =>
    tool({
      description: [
        "Which meeting rooms are free in a given window, and which are taken.",
        'Use for "is there a room free at 2", "which rooms are available tomorrow morning", "where can we meet".',
        "Returns, per room: its name, capacity, whether it is free for the window asked about, and what is booked in it if not.",
        "",
        "For the meetings themselves rather than the rooms they are in, use list_meetings.",
      ].join("\n"),
      inputSchema: z.object({
        from: z.string().describe("Window start, an ISO timestamp."),
        to: z.string().describe("Window end, an ISO timestamp."),
      }),
      execute: async ({ from, to }) => {
        const rooms = await ctx.deps.spine.readMany({ actor: ctx.actor, nodeType: "room" });
        const bookings = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "booking",
          filter: (data) => {
            const d = data as { from?: string; to?: string };
            // Overlap: starts before the window ends and ends after it starts.
            return (d.from ?? "") < to && (d.to ?? "") > from;
          },
        });
        ctx.noteAll(
          "room",
          rooms.map((r) => r.nodeId),
        );
        ctx.noteAll(
          "booking",
          bookings.map((b) => b.nodeId),
        );

        const takenBy = new Map<string, Array<Record<string, unknown>>>();
        for (const b of bookings) {
          const roomId = visible(b.record.roomId) as string | undefined;
          if (!roomId) continue;
          const list = takenBy.get(roomId) ?? [];
          list.push(safeFields(b.record, ["title", "from", "to"]));
          takenBy.set(roomId, list);
        }

        return shape(rooms, (r) => {
          const clashes = takenBy.get(r.nodeId) ?? [];
          return {
            id: r.nodeId,
            ...safeFields(r.record, ["name", "capacity", "location"]),
            free: clashes.length === 0,
            bookedFor: clashes.length > 0 ? clashes : undefined,
          };
        });
      },
    }),
};


export const getCourse: ToolSpec = {
  name: "get_course",
  requires: { action: "view", nodeType: "course" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT compare courses or tell you which are behind — it returns ONE course only. For percentages across all of them, or which have gone stale, use course_progress.",
        "It returns the course as it stands NOW. For what CHANGED and when, use course_versions.",
        "It does not list who is working on it either — for that, use course_assignees.",
        "",
        "One course in full, by id or by title.",
        'Use for "tell me about AI Basics", "what stage is the induction course at", "what modules does it have", "who owns it".',
        "Returns its title, stage, owner, the modules with each one's state, the completion percentage, any progress note, and how long it has been waiting in its current stage.",
      ].join("\n"),
      inputSchema: z.object({
        course: z.string().describe("The course id, or its title."),
      }),
      execute: async ({ course }) => {
        const courses = await ctx.deps.spine.readMany({ actor: ctx.actor, nodeType: "course" });
        const match =
          courses.find((c) => c.nodeId === course) ??
          courses.find(
            (c) => String(c.record.title ?? "").toLowerCase() === course.toLowerCase(),
          ) ??
          courses.find((c) =>
            String(c.record.title ?? "").toLowerCase().includes(course.toLowerCase()),
          );
        if (!match) return { found: false, note: `No course matching "${course}".` };
        ctx.note("course", match.nodeId);

        // The progress figure comes from the service, which reads the graph
        // directly — so it is only consulted for a course already proven
        // visible above.
        const progress = await ctx.deps.courses.getProgress(
          match.nodeId,
          `${ctx.deps.today()}T23:59:59Z`,
        );
        const owner = visible(match.record.owner) as string | undefined;
        const modules =
          (visible(match.record.modules) as Array<{ name: string; state: string }> | undefined) ??
          [];
        return {
          found: true,
          course: {
            id: match.nodeId,
            ...safeFields(match.record, ["title", "stage", "stageEnteredAt"]),
            owner: owner ? { id: owner, name: directory().nameOf(owner) } : undefined,
            modules: modules.map((m) => ({ name: m.name, state: m.state })),
            completionPercent: progress?.completion?.value,
            stale: progress?.stale,
            daysWaiting: progress?.daysWaiting,
            progressNote: progress?.progressNote?.text,
          },
        };
      },
    }),
};

export const courseVersions: ToolSpec = {
  name: "course_versions",
  requires: { action: "view", nodeType: "course-version" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT return the course as it is now — only the history of edits to it. For its current state, modules and stage, use get_course.",
        "",
        "What CHANGED on a course, and when.",
        'Use for "what changed in the induction course", "who edited it last", "has this been revised", "what did it look like before".',
        "Returns, per version: the version number, the exact date and time it was saved (an ISO timestamp), who saved it, and the reason they gave. Newest first.",
        "Dates are always returned as real timestamps — never as 'recently' — so you can state them exactly.",
      ].join("\n"),
      inputSchema: z.object({
        course: z.string().describe("The course id."),
        limit: z.number().optional().describe("How many versions back. Defaults to all, capped."),
      }),
      execute: async ({ course, limit }) => {
        // Prove the course itself is visible before returning its history.
        const parent = await ctx.deps.spine.read({
          actor: ctx.actor,
          nodeType: "course",
          nodeId: course,
        });
        if (!parent.found) return { found: false, note: `No course matching "${course}".` };

        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "course-version",
          filter: (data) => (data as { courseId?: string }).courseId === course,
        });
        ctx.noteAll(
          "course-version",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        const sorted = [...rows].sort(
          (a, b) => Number(b.record.version ?? 0) - Number(a.record.version ?? 0),
        );
        return {
          found: true,
          course,
          courseTitle: visible(parent.record.title),
          ...shape(sorted, (r) => {
            const by = visible(r.record.by) as string | undefined;
            return {
              version: visible(r.record.version),
              // A real timestamp. "Recently" is what the model would invent.
              at: visible(r.record.at),
              by: by ? dir.nameOf(by) : undefined,
              reason: visible(r.record.reason),
            };
          }, { cap: limit && limit > 0 ? limit : undefined }),
        };
      },
    }),
};

export const getTask: ToolSpec = {
  name: "get_task",
  requires: { action: "view", nodeType: "task" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT search or list — it returns ONE task, and you must already have its id. To find tasks by person, status, course or due date, use list_tasks.",
        "",
        "One task in full, by id.",
        'Use for "what is the status of that task", "when is it due", "who is it assigned to", after another tool has given you a task id.',
        "Returns its title, who it is assigned to, status, priority, due date, the course it belongs to if any, who created it, and its time estimate.",
      ].join("\n"),
      inputSchema: z.object({
        taskId: z.string().describe("The task id, as returned by list_tasks or course_assignees."),
      }),
      execute: async ({ taskId }) => {
        const result = await ctx.deps.spine.read({
          actor: ctx.actor,
          nodeType: "task",
          nodeId: taskId,
        });
        if (!result.found) return { found: false, note: `No task matching "${taskId}".` };
        ctx.note("task", taskId);
        const who = visible(result.record.assignedTo) as string | undefined;
        const by = visible(result.record.createdBy) as string | undefined;
        const dir = directory();
        return {
          found: true,
          task: {
            id: taskId,
            ...safeFields(result.record, [
              "title",
              "status",
              "priority",
              "dueDate",
              "courseId",
              "estimateMinutes",
            ]),
            assignedTo: who ? { id: who, name: dir.nameOf(who) } : undefined,
            createdBy: by ? dir.nameOf(by) : undefined,
          },
        };
      },
    }),
};

export const workTools: ToolSpec[] = [
  courseProgress,
  courseAssignees,
  getCourse,
  courseVersions,
  listTasks,
  getTask,
  listMeetings,
  roomAvailability,
];
