import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "./catalogue";
import { shape, visible } from "./shape";

/**
 * The two tools that belong to no domain.
 *
 * `explain_figure` answers a question about **any** number, which is why it is
 * not a Figures specialist — "why is that 60%?" is not a domain.
 *
 * `search` is the most dangerous description in the catalogue and is discussed
 * at length below.
 */

export const explainFigure: ToolSpec = {
  name: "explain_figure",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT find figures or tell you what a number is — you must already have a figure id. To get a course's completion percentage in the first place, use course_progress or get_course.",
        "",
        "What a number is MADE OF: the parts a figure was computed from.",
        'Use for "why is that 60%", "how is that worked out", "what goes into that number", "show me the breakdown".',
        "Returns the figure itself — its label, value and unit — and each part that contributed, with that part's own value.",
        "",
        "Only ONE kind of figure exists in this organisation at present: course completion. Any other number you have seen — a streak, a day tally, a leave balance, a count on a card — is not a figure and has no breakdown. Say so rather than inventing one.",
      ].join("\n"),
      inputSchema: z.object({
        figureId: z
          .string()
          .describe("The figure id, as returned by a tool that reported the number."),
      }),
      execute: async ({ figureId }) => {
        const result = await ctx.deps.figures.breakdown(figureId);
        if (!result) {
          return {
            found: false,
            note: `No figure "${figureId}". Only course-completion figures exist; other numbers are not figures and have no parts.`,
          };
        }

        // A figure hangs off a record, and the record decides who may see it.
        // `FigureStore` has no permission layer of its own, so the check is
        // made here rather than assumed — feature 06 must not become a way
        // round the gate for numbers about records you cannot open.
        const figure = result.figure as unknown as {
          nodeType?: string;
          nodeId?: string;
          label?: string;
          value?: number;
          unit?: string;
          explainer?: string;
        };
        if (figure.nodeType && figure.nodeId) {
          const parent = await ctx.deps.spine.read({
            actor: ctx.actor,
            nodeType: figure.nodeType,
            nodeId: figure.nodeId,
          });
          if (!parent.found) {
            // Indistinguishable from "no such figure", deliberately.
            return { found: false, note: `No figure "${figureId}".` };
          }
          ctx.note(figure.nodeType, figure.nodeId);
        }
        ctx.note("figure", figureId);

        return {
          found: true,
          figure: {
            id: figureId,
            label: figure.label,
            value: figure.value,
            unit: figure.unit,
            explainer: figure.explainer,
            about:
              figure.nodeType && figure.nodeId
                ? { nodeType: figure.nodeType, nodeId: figure.nodeId }
                : undefined,
          },
          parts: result.parts,
        };
      },
    }),
};

/**
 * Everything the actor can see, matched loosely — and deliberately made to lose.
 *
 * ── Why this description is written the way it is ───────────────────────────
 *
 * A general search competes with all thirty-two other tools on **every** vague
 * question, and it will usually be *able* to answer — worse. It returns loose
 * matches with no totals, no dates and no structure, so if the model reaches
 * for it over `list_leave` the answer degrades without failing, which is the
 * hardest kind of regression to notice.
 *
 * The description is the only thing standing between that and a good answer, so
 * it does three things on purpose: it says **USE THIS LAST** in the imperative
 * before anything else, it **enumerates the competitors** so the model does not
 * have to infer the list, and it **states what it gives up**. 1a proved the
 * negative clause is what does the work; here it is the entire argument.
 *
 * ── On the backing read ─────────────────────────────────────────────────────
 *
 * The plan expected an "existing permission-filtered global search" to wrap.
 * There is none — the sidebar search is client-side and there is no search
 * endpoint. So this composes `spine.readMany` across a fixed list of node
 * types, which is permission-filtered per record by construction and touches
 * the graph no more directly than any other tool.
 */
const SEARCHABLE = [
  "employee",
  "course",
  "task",
  "meeting",
  "event",
  "document",
  "equipment",
  "org-memory",
  "room",
] as const;

export const search: ToolSpec = {
  name: "search",
  build: (ctx) =>
    tool({
      description: [
        "USE THIS LAST. Almost every question has a better tool than this one.",
        "",
        "If the question is about PEOPLE use find_people or get_person; about LEAVE use list_leave or leave_balance; about ATTENDANCE use attendance; about COURSES use course_progress or get_course; about TASKS use list_tasks or get_task; about MEETINGS use list_meetings or get_meeting; about a PERIOD use calendar_month; about EVENTS use list_events; about DOCUMENTS use list_documents or expiring_documents; about EQUIPMENT use list_equipment or equipment_faults; about YOUR DAY use my_day or my_history; about a DECISION use search_memory.",
        "Each of those returns proper totals, real dates and a structured shape. This tool returns none of that — just loose text matches, capped, with no ordering and no counts you can rely on.",
        "",
        "Search across everything the person asking can see, when nothing more specific fits.",
        "Reach for it only when the question names something that belongs to no single one of those areas: an unfamiliar term, an id whose type is not obvious, or a phrase somebody half-remembers and cannot place.",
        "Returns loose matches with their record type and id, so a more specific tool can then be used to look one up properly.",
      ].join("\n"),
      inputSchema: z.object({
        query: z.string().describe("Words to look for."),
        nodeType: z
          .string()
          .optional()
          .describe("Restrict to one record type, if you already know it."),
      }),
      execute: async ({ query, nodeType }) => {
        const words = query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2);
        if (words.length === 0) {
          return { items: [], total: 0, truncated: false, note: "Nothing to search for." };
        }

        const types = nodeType
          ? SEARCHABLE.filter((t) => t === nodeType)
          : [...SEARCHABLE];

        const hits: Array<{ nodeType: string; nodeId: string; match: string }> = [];
        for (const type of types) {
          // Every read goes through the gate, per record. A search cannot be a
          // way round it, because it is made of the same calls as everything.
          const rows = await ctx.deps.spine.readMany({
            actor: ctx.actor,
            nodeType: type,
            filter: (data) => {
              const haystack = JSON.stringify(data).toLowerCase();
              return words.some((w) => haystack.includes(w));
            },
          });
          for (const r of rows) {
            const label =
              (visible(r.record.title) as string | undefined) ??
              (visible(r.record.name) as string | undefined) ??
              (visible(r.record.label) as string | undefined) ??
              r.nodeId;
            hits.push({ nodeType: type, nodeId: r.nodeId, match: String(label) });
          }
        }
        ctx.noteAll("search", []);
        for (const h of hits) ctx.note(h.nodeType, h.nodeId);

        return {
          ...shape(hits, (h) => h),
          searchedTypes: types,
          note:
            hits.length === 0
              ? `Nothing matching "${query}". Say so rather than guessing.`
              : "Loose matches only. Use the tool for that record type to get a proper answer about any of these.",
        };
      },
    }),
};

export const crossTools: ToolSpec[] = [explainFigure, search];
