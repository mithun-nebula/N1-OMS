import { tool } from "ai";
import { z } from "zod";
import { directory } from "@/server/directory";
import type { ToolSpec } from "./catalogue";
import { shape, safeFields, visible } from "./shape";
import { PERIODS, resolveWindow, withinWindow } from "./window";
import { isInTheMeeting } from "@/domains/workplace/meeting-access";

/**
 * Meetings, the calendar, and organisation events.
 *
 * Three tools in here answer *"what's on Thursday?"* equally well, which is the
 * densest ambiguity in the whole catalogue. The confusion matrix settles it
 * once, and all three descriptions repeat the same ruling rather than each
 * arguing its own case:
 *
 *   a question about a PERIOD  -> calendar_month  (the superset)
 *   a question about a MEETING -> list_meetings / get_meeting
 *   a question about an EVENT  -> list_events / get_event
 *
 * `list_events` and `list_meetings` both point at `calendar_month` for the day
 * question rather than at each other. Adding a third contender to a two-way
 * ambiguity makes it worse; sending both somewhere else resolves it.
 */

interface MeetingDecisionRow {
  id: string;
  text: string;
  owner?: string;
}

interface MeetingActionRow {
  id: string;
  text: string;
  owner: string;
  due?: string;
  done?: boolean;
}

export const getMeeting: ToolSpec = {
  name: "get_meeting",
  requires: { action: "view", nodeType: "meeting" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT search — it returns ONE meeting and you must already have its id. To find meetings by person or date, use list_meetings.",
        "For a decision the organisation took deliberately and wrote down, rather than one minuted inside a particular meeting, use search_memory — those are different records.",
        "",
        "One meeting in full, including WHAT WAS DECIDED in it.",
        'Use for "what was decided in the review", "what actions came out of it", "who was at the standup", "what is the link for that meeting".',
        "Returns its title, start and end times, attendees, whether it is online or in person, the joining link, and every decision and action recorded against it with their owners and due dates.",
      ].join("\n"),
      inputSchema: z.object({
        meetingId: z.string().describe("The meeting id, as returned by list_meetings."),
      }),
      execute: async ({ meetingId }) => {
        const result = await ctx.deps.spine.read({
          actor: ctx.actor,
          nodeType: "meeting",
          nodeId: meetingId,
        });
        if (!result.found) return { found: false, note: `No meeting matching "${meetingId}".` };
        ctx.note("meeting", meetingId);

        // A meeting without what was decided is half a record, so the decision
        // set is read alongside it — through the gate, like everything else, so
        // somebody who may see the meeting but not its decisions gets neither.
        const decisionsId = `decisions:${meetingId}`;
        const decisions = await ctx.deps.spine.read({
          actor: ctx.actor,
          nodeType: "meeting-decision",
          nodeId: decisionsId,
        });
        if (decisions.found) ctx.note("meeting-decision", decisionsId);

        const dir = directory();
        const attendees = (visible(result.record.attendees) as string[] | undefined) ?? [];
        const decided =
          (visible(decisions.found ? decisions.record.decisions : undefined) as
            | MeetingDecisionRow[]
            | undefined) ?? [];
        const actions =
          (visible(decisions.found ? decisions.record.actions : undefined) as
            | MeetingActionRow[]
            | undefined) ?? [];

        // The link is the way into the room, not a fact about the meeting, so
        // it travels only with the people on it. Everything else about the
        // meeting stays open — meetings carry no RBAC by design.
        const fields: string[] = ["title", "from", "to", "kind", "cancelled"];
        if (isInTheMeeting(ctx.actor, result.record)) fields.push("link");
        return {
          found: true,
          meeting: {
            id: meetingId,
            ...safeFields(result.record, fields),
            attendees: attendees.map((a) => ({ id: a, name: dir.nameOf(a) })),
          },
          decisions: decided.map((d) => ({
            text: d.text,
            owner: d.owner ? dir.nameOf(d.owner) : undefined,
          })),
          actions: actions.map((a) => ({
            text: a.text,
            owner: a.owner ? dir.nameOf(a.owner) : undefined,
            due: a.due,
            done: a.done === true,
          })),
          ...(decided.length === 0 && actions.length === 0
            ? { note: "Nothing was recorded as decided in this meeting." }
            : {}),
        };
      },
    }),
};

export const calendarMonth: ToolSpec = {
  name: "calendar_month",
  requires: { action: "view", nodeType: "calendar-entry" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT return one specific meeting or its attendees — for that use list_meetings, or get_meeting if you have an id.",
        "",
        "EVERYTHING in the diary over a period — the superset. Calendar entries, and the days things fall on.",
        'Use this for any question about a STRETCH OF TIME rather than about one booking: "what is on next week", "what is happening this month", "what is in the diary on Thursday", "is anything on over the holidays".',
        "When a question is about a period, prefer this over list_meetings and list_events — they each cover only their own kind, and this covers the span.",
        "Returns, per entry: title, kind, the date (YYYY-MM-DD), start and end times, who is involved, and any detail recorded.",
        "Always returns the exact window it looked at. State those dates rather than working any out yourself.",
      ].join("\n"),
      inputSchema: z.object({
        period: z
          .enum(PERIODS)
          .optional()
          .describe("A named period. Do NOT calculate dates yourself — name the period."),
        from: z.string().optional().describe("Explicit start, YYYY-MM-DD. Overrides period."),
        to: z.string().optional().describe("Explicit end, YYYY-MM-DD. Overrides period."),
        person: z.string().optional().describe("Only entries involving this employee id."),
      }),
      execute: async ({ period, from, to, person }) => {
        // The tool most likely to reproduce 1a's date bug, so it is the one
        // that most obviously must not let the model near the arithmetic.
        const window = resolveWindow(ctx.deps.today(), {
          period: period ?? "this-month",
          from,
          to,
        });
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "calendar-entry",
          filter: (data) => {
            const d = data as { date?: string; people?: string[] };
            if (person && !(d.people ?? []).includes(person)) return false;
            return withinWindow(d.date, window);
          },
        });
        ctx.noteAll(
          "calendar-entry",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        return {
          window,
          ...shape(
            [...rows].sort((a, b) =>
              String(a.record.date ?? "").localeCompare(String(b.record.date ?? "")),
            ),
            (r) => {
              const people = (visible(r.record.people) as string[] | undefined) ?? [];
              return {
                id: r.nodeId,
                ...safeFields(r.record, ["title", "kind", "date", "from", "to", "detail"]),
                people: people.map((p) => dir.nameOf(p)),
              };
            },
          ),
        };
      },
    }),
};

export const listEvents: ToolSpec = {
  name: "list_events",
  requires: { action: "view", nodeType: "event" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT return meetings. An organisation event — a training day, an induction, a launch — is a different record from a meeting in somebody's diary. For meetings, use list_meetings.",
        'For a question about a whole period rather than about events specifically — "what is on Thursday", "what is happening next week" — use calendar_month, which covers everything in the diary.',
        "",
        "Organisation events: what is planned, running or finished.",
        'Use for "what events are coming up", "how many people registered", "did the induction close", "what is the budget for it".',
        "Returns, per event: title, date, status (planning, live or closed), capacity, how many have registered, and whether a report was filed.",
        "Also returns the window it looked at, so its dates can be checked.",
        "Always name a period rather than working dates out yourself — this tool resolves it and returns the exact window it used. State those dates.",
      ].join("\n"),
      inputSchema: z.object({
        status: z.enum(["planning", "live", "closed"]).optional(),
        period: z.enum(PERIODS).optional().describe("A named period. Do not calculate dates."),
        from: z.string().optional().describe("Explicit start, YYYY-MM-DD."),
        to: z.string().optional().describe("Explicit end, YYYY-MM-DD."),
      }),
      execute: async ({ status, period, from, to }) => {
        const window = resolveWindow(ctx.deps.today(), {
          period: period ?? "last-90-days",
          from,
          to,
        });
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "event",
          filter: (data) => {
            const d = data as { status?: string; date?: string };
            if (status && d.status !== status) return false;
            return withinWindow(d.date, window);
          },
        });
        ctx.noteAll(
          "event",
          rows.map((r) => r.nodeId),
        );
        return {
          window,
          ...shape(rows, (r) => {
            const regs = (visible(r.record.registrations) as string[] | undefined) ?? [];
            return {
              id: r.nodeId,
              ...safeFields(r.record, ["title", "date", "status", "capacity"]),
              registered: regs.length,
              reported: Boolean(visible(r.record.report)),
            };
          }),
        };
      },
    }),
};

export const getEvent: ToolSpec = {
  name: "get_event",
  requires: { action: "view", nodeType: "event" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT search — it returns ONE event and you must already have its id. To find events, use list_events.",
        "It is not a meeting: for who attended a meeting, use get_meeting.",
        "",
        "One event in full, including WHO HAS REGISTERED.",
        'Use for "who is coming to the induction", "how many places are left", "what tasks are attached to it", "what did the report say".',
        "Returns its title, date, status, capacity, the people registered by name, the tasks attached to it, its budget, and the closing report if one was filed.",
      ].join("\n"),
      inputSchema: z.object({
        eventId: z.string().describe("The event id, as returned by list_events."),
      }),
      execute: async ({ eventId }) => {
        const result = await ctx.deps.spine.read({
          actor: ctx.actor,
          nodeType: "event",
          nodeId: eventId,
        });
        if (!result.found) return { found: false, note: `No event matching "${eventId}".` };
        ctx.note("event", eventId);
        const dir = directory();
        const regs = (visible(result.record.registrations) as string[] | undefined) ?? [];
        const tasks =
          (visible(result.record.tasks) as Array<{ title?: string; done?: boolean }> | undefined) ??
          [];
        const capacity = visible(result.record.capacity) as number | undefined;
        return {
          found: true,
          event: {
            id: eventId,
            ...safeFields(result.record, ["title", "date", "status", "capacity", "report"]),
            registered: regs.map((r) => ({ id: r, name: dir.nameOf(r) })),
            registeredCount: regs.length,
            placesLeft: typeof capacity === "number" ? Math.max(0, capacity - regs.length) : undefined,
            tasks: tasks.map((t) => ({ title: t.title, done: t.done === true })),
            budget: visible(result.record.budget),
          },
        };
      },
    }),
};

export const scheduleTools: ToolSpec[] = [getMeeting, calendarMonth, listEvents, getEvent];
