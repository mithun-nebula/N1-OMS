import { tool } from "ai";
import { z } from "zod";
import { directory } from "@/server/directory";
import { findExpiringDocuments } from "@/domains/workplace";
import type { ToolSpec } from "./catalogue";
import { shape, safeFields, visible } from "./shape";
import { PERIODS, resolveWindow, withinWindow } from "./window";

/**
 * Equipment, documents, the day, and what the organisation has decided before.
 *
 * `list_documents` / `expiring_documents` and `list_equipment` /
 * `equipment_faults` are the third and fourth confusable pairs, so they point
 * at each other the same way the people tools do.
 */

export const listEquipment: ToolSpec = {
  name: "list_equipment",
  requires: { action: "view", nodeType: "equipment" },
  build: (ctx) =>
    tool({
      description: [
        "The equipment register — what kit exists and who holds it.",
        'Use for "what laptops do we have", "who has the projector", "what is assigned to Priya", "how much equipment is there".',
        "Returns, per item: name, kind, its current holder, location, and condition.",
        "",
        "For things that are BROKEN — faults reported, repeat offenders — use equipment_faults instead. This tool does not say whether anything is working.",
        "For readings and notes logged about the building and its services, use utility_log.",
      ].join("\n"),
      inputSchema: z.object({
        heldBy: z.string().optional().describe("Only equipment held by this employee id."),
        kind: z.string().optional().describe("Only this kind of item, e.g. laptop."),
      }),
      execute: async ({ heldBy, kind }) => {
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "equipment",
          filter: (data) => {
            const d = data as { assignedTo?: string; holder?: string; kind?: string };
            const holder = d.assignedTo ?? d.holder;
            if (heldBy && holder !== heldBy) return false;
            if (kind && (d.kind ?? "").toLowerCase() !== kind.toLowerCase()) return false;
            return true;
          },
        });
        ctx.noteAll(
          "equipment",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        return shape(rows, (r) => {
          const holder = (visible(r.record.assignedTo) ?? visible(r.record.holder)) as
            | string
            | undefined;
          return {
            id: r.nodeId,
            ...safeFields(r.record, ["name", "kind", "location", "condition", "serial"]),
            heldBy: holder ? dir.nameOf(holder) : undefined,
          };
        });
      },
    }),
};

export const equipmentFaults: ToolSpec = {
  name: "equipment_faults",
  requires: { action: "view", nodeType: "fault" },
  build: (ctx) =>
    tool({
      description: [
        "Faults reported against equipment, and which items keep breaking.",
        'Use for "is anything broken", "what faults were reported", "has the projector failed before", "what keeps going wrong".',
        "Returns, per fault: which item, what the fault was, who reported it and when. Also flags any item with more than one fault as a repeat.",
        "",
        "For the register of what equipment exists and who holds it, use list_equipment instead.",
        "For meter readings and service notes, which are not faults, use utility_log.",
      ].join("\n"),
      inputSchema: z.object({
        equipmentId: z.string().optional().describe("Only faults against this item."),
        repeatsOnly: z
          .boolean()
          .optional()
          .describe("Only items that have failed more than once. Use for 'what keeps breaking'."),
      }),
      execute: async ({ equipmentId, repeatsOnly }) => {
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "fault",
          filter: (data) =>
            !equipmentId || (data as { equipmentId?: string }).equipmentId === equipmentId,
        });
        ctx.noteAll(
          "fault",
          rows.map((r) => r.nodeId),
        );

        // Repeat detection: an item with more than one fault on record.
        const counts = new Map<string, number>();
        for (const r of rows) {
          const eq = visible(r.record.equipmentId) as string | undefined;
          if (eq) counts.set(eq, (counts.get(eq) ?? 0) + 1);
        }
        const filtered = repeatsOnly
          ? rows.filter((r) => (counts.get(String(r.record.equipmentId)) ?? 0) > 1)
          : rows;

        const dir = directory();
        return {
          ...shape(filtered, (r) => {
            const eq = visible(r.record.equipmentId) as string | undefined;
            const by = visible(r.record.by) as string | undefined;
            return {
              id: r.nodeId,
              equipmentId: eq,
              ...safeFields(r.record, ["fault", "at"]),
              reportedBy: by ? dir.nameOf(by) : undefined,
              repeatOffender: eq ? (counts.get(eq) ?? 0) > 1 : false,
            };
          }),
          repeatItems: [...counts.entries()]
            .filter(([, n]) => n > 1)
            .map(([id, n]) => ({ equipmentId: id, faults: n })),
        };
      },
    }),
};

export const listDocuments: ToolSpec = {
  name: "list_documents",
  requires: { action: "view", nodeType: "document" },
  build: (ctx) =>
    tool({
      description: [
        "The document register — what documents exist, who they belong to, and which required ones are missing.",
        'Use for "what documents do we hold for Priya", "what is missing", "do we have their contract", "what is on file".',
        "Returns, per document: name, kind, whose it is, whether it is required, and whether it has actually been supplied.",
        "",
        "For documents running out of date, use expiring_documents instead — that one sorts by how long is left, and this one does not consider dates at all.",
        "For which REQUIRED documents are still outstanding and from whom, use required_documents. Note that no tool can say who has READ a document — that is not recorded anywhere.",
      ].join("\n"),
      inputSchema: z.object({
        person: z.string().optional().describe("Only documents belonging to this employee id."),
        missingOnly: z
          .boolean()
          .optional()
          .describe("Only required documents that have not been supplied."),
      }),
      execute: async ({ person, missingOnly }) => {
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "document",
          filter: (data) => {
            const d = data as {
              employeeId?: string;
              owner?: string;
              required?: boolean;
              supplied?: boolean;
            };
            const who = d.employeeId ?? d.owner;
            if (person && who !== person) return false;
            if (missingOnly && !(d.required === true && d.supplied !== true)) return false;
            return true;
          },
        });
        ctx.noteAll(
          "document",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        return shape(rows, (r) => {
          const who = (visible(r.record.employeeId) ?? visible(r.record.owner)) as
            | string
            | undefined;
          return {
            id: r.nodeId,
            ...safeFields(r.record, ["name", "kind", "required", "supplied", "expiresOn"]),
            belongsTo: who ? dir.nameOf(who) : undefined,
          };
        });
      },
    }),
};

export const expiringDocuments: ToolSpec = {
  name: "expiring_documents",
  requires: { action: "view", nodeType: "document" },
  build: (ctx) =>
    tool({
      description: [
        "Documents that are about to run out, soonest first.",
        'Use for "whose documents expire soon", "what needs renewing", "is anything out of date", "what expires this month".',
        "Returns, per document: its name, the date it expires (YYYY-MM-DD), and how many days are left — negative if it has already lapsed.",
        "",
        "For the full register, including documents with no expiry at all, use list_documents instead.",
        "For required documents that are simply missing rather than expiring, use required_documents.",
      ].join("\n"),
      inputSchema: z.object({
        withinDays: z
          .number()
          .optional()
          .describe("How far ahead to look. Defaults to 30 days."),
      }),
      execute: async ({ withinDays = 30 }) => {
        const found = await findExpiringDocuments(
          ctx.deps.graph,
          `${ctx.deps.today()}T00:00:00Z`,
          withinDays,
        );
        // `findExpiringDocuments` reads the graph directly, so visibility has to
        // be re-applied here — the tool must not become a way around the gate.
        const allowed = new Set(
          (
            await ctx.deps.spine.readMany({ actor: ctx.actor, nodeType: "document" })
          ).map((r) => r.nodeId),
        );
        const rows = found
          .filter((d) => allowed.has(d.id))
          .sort((a, b) => a.daysLeft - b.daysLeft);
        ctx.noteAll(
          "document",
          rows.map((r) => r.id),
        );
        return shape(rows, (d) => ({
          id: d.id,
          name: d.name,
          expiresOn: d.expiresOn,
          daysLeft: d.daysLeft,
          alreadyExpired: d.daysLeft < 0,
        }));
      },
    }),
};

export const myDay: ToolSpec = {
  name: "my_day",
  build: (ctx) =>
    tool({
      description: [
        "What the person asking committed to TODAY, with times — their own day plan.",
        'Use for "what is on me today", "what am I meant to be doing", "how is my day looking", "what have I got left".',
        "Returns today's committed items with their id, start time and whether each is done, the meetings in the day, and how the day divides between meetings, work and free time.",
        "The id is what mark_done, drop_item and carry_over need — call this first if you do not have one, and never invent one.",
        "",
        "Only ever about the person asking — it cannot look at anybody else's day.",
        "For the task board across everyone, or for work not committed to today, use list_tasks instead.",
        "For the days BEHIND you — how last week went, how many days you have planned — use my_history. This tool is today only.",
        "It is only ever about YOU. For what one person on your team committed to, use team_day.",
      ].join("\n"),
      inputSchema: z.object({}),
      execute: async () => {
        const service = ctx.deps.dayPlan;
        if (!service) return { found: false, note: "The day plan is not available." };
        const date = ctx.deps.today();
        await service.getStore().load(ctx.actor, date);
        const plan = service.getStore().get(ctx.actor, date);
        if (!plan) {
          // Honest: nothing has been planned, rather than an empty list that
          // reads like "you have nothing to do".
          return {
            found: false,
            note: "No day has been started yet today, so nothing has been committed to.",
          };
        }
        const { rows, tally } = service.dashboard(ctx.actor, date);
        ctx.note("day-plan", `${ctx.actor}:${date}`);
        return {
          found: true,
          date,
          phase: plan.phase,
          items: rows.map((r) => ({
            // The id matters: it is what mark_done, drop_item and carry_over
            // take. Without it the model has to guess one, and a real morning
            // found it doing exactly that — "I could not find Module 4 on your
            // plan" for an item that was plainly on the plan.
            id: r.id,
            kind: r.kind,
            title: r.title,
            startsAt: r.start,
            done: r.done,
            note: r.tag,
          })),
          minutes: { meetings: tally.meetings, work: tally.work, free: tally.free },
        };
      },
    }),
};

export const searchMemory: ToolSpec = {
  name: "search_memory",
  requires: { action: "view", nodeType: "org-memory" },
  build: (ctx) =>
    tool({
      description: [
        "Search decisions the organisation has already recorded, and the reason given at the time.",
        'Use for "what did we decide about shadowing", "why do we do it this way", "has this come up before", "what was agreed".',
        "Returns, per decision: its title, what was decided, the reason recorded then, who decided it and when.",
        "",
        "This is a plain keyword search over recorded decisions — it will not find something that was never written down, and it does not search tasks, meetings or documents.",
        "A decision minuted inside one meeting is a DIFFERENT record: for that, use get_meeting. This tool holds deliberate, durable organisational decisions, not what was agreed in a particular room.",
      ].join("\n"),
      inputSchema: z.object({
        query: z
          .string()
          .describe("Words to look for in the title, the decision, or the reason."),
      }),
      execute: async ({ query }) => {
        const words = query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2);
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "org-memory",
          filter: (data) => {
            if (words.length === 0) return true;
            const haystack = JSON.stringify(data).toLowerCase();
            return words.some((w) => haystack.includes(w));
          },
        });
        ctx.noteAll(
          "org-memory",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        const shaped = shape(rows, (r) => {
          const by = visible(r.record.decidedBy) as string | undefined;
          return {
            id: r.nodeId,
            ...safeFields(r.record, ["title", "decision", "reasonAtTime", "decidedAt"]),
            decidedBy: by ? dir.nameOf(by) : undefined,
          };
        });
        return {
          ...shaped,
          ...(shaped.total === 0
            ? { note: `Nothing recorded matching "${query}". Say so rather than guessing.` }
            : {}),
        };
      },
    }),
};


export const utilityLog: ToolSpec = {
  name: "utility_log",
  requires: { action: "view", nodeType: "utility-capture" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT report faults — a broken meter is a fault, and faults live in equipment_faults. It also does not list what equipment exists; for the register, use list_equipment.",
        "",
        "The utilities log — short readings and notes captured about the building and its services.",
        'Use for "what was logged about the water", "any notes on the generator", "what did somebody record yesterday".',
        "Returns, per entry: the subject, the detail recorded, who recorded it and when, and the period it covers if one was given.",
        "Also returns the window it looked at, so the dates in your answer can be checked against it.",
        "Always name a period rather than working dates out yourself — this tool resolves it and returns the exact window it used. State those dates.",
      ].join("\n"),
      inputSchema: z.object({
        subject: z.string().optional().describe("Only entries about this subject."),
        period: z
          .enum(PERIODS)
          .optional()
          .describe("A named period. Do NOT work dates out yourself."),
        from: z.string().optional().describe("Explicit start, YYYY-MM-DD."),
        to: z.string().optional().describe("Explicit end, YYYY-MM-DD."),
      }),
      execute: async ({ subject, period, from, to }) => {
        const window = resolveWindow(ctx.deps.today(), { period, from, to });
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "utility-capture",
          filter: (data) => {
            const d = data as { subject?: string; at?: string };
            if (subject && !(d.subject ?? "").toLowerCase().includes(subject.toLowerCase())) {
              return false;
            }
            return withinWindow(d.at, window);
          },
        });
        ctx.noteAll(
          "utility-capture",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        return {
          window,
          ...shape(rows, (r) => {
            const by = visible(r.record.by) as string | undefined;
            return {
              id: r.nodeId,
              ...safeFields(r.record, ["subject", "detail", "at", "from", "to"]),
              recordedBy: by ? dir.nameOf(by) : undefined,
            };
          }),
        };
      },
    }),
};

/**
 * Who still owes a required document.
 *
 * ── Why this is not `document_acknowledgements` ─────────────────────────────
 *
 * The plan asked for a tool answering *"who has read what"*, backed by
 * `readMany({nodeType:"document"})` **plus acknowledgement state**. That state
 * does not exist. `DocumentData` carries `name`, `nodeType`, `nodeId`,
 * `contentType`, `blobRef`, `version`, `required`, `requiredBy`, `expiresOn`
 * and `roleAccess` — and nothing recording that a person has read anything.
 * The only two operations are `document.store` and `document.require`.
 *
 * It is not an oversight in the schema either: `assistant/briefing.ts` records
 * that announcements **and their acknowledge chase** were replaced by
 * messaging. The read-receipt went with them.
 *
 * Building the named tool anyway would mean a tool that confidently answers a
 * question nothing in the system can answer — precisely the failure this whole
 * stage is written to avoid. So it answers the adjacent question that **is**
 * recorded, is named for what it actually does, and says in its own description
 * that acknowledgement is not tracked.
 *
 * Policy acknowledgement specifically *is* tracked, as an onboarding step
 * ("Acknowledge policies") — so the description points at `joining_status`.
 */
export const requiredDocuments: ToolSpec = {
  name: "required_documents",
  requires: { action: "view", nodeType: "document" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT show who has READ or acknowledged a document. Nothing in this organisation records read-receipts, so no tool can answer that — say so rather than guessing. For the one acknowledgement that IS tracked, the 'Acknowledge policies' step a new starter completes, use joining_status.",
        "It also does not list every document; for the full register use list_documents. It does not sort by expiry either; for what is running out, use expiring_documents.",
        "",
        "Which required documents are still outstanding, and from whom.",
        'Use for "what is missing", "whose paperwork is incomplete", "what do we still need from Ravi", "is anyone short a document".',
        "Returns, per outstanding document: its name, what it relates to, who it is required from, and whether it has been supplied.",
      ].join("\n"),
      inputSchema: z.object({
        person: z.string().optional().describe("Only documents required from this employee id."),
        includeSupplied: z
          .boolean()
          .optional()
          .describe("Include ones already supplied. Defaults to false — outstanding only."),
      }),
      execute: async ({ person, includeSupplied = false }) => {
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "document",
          filter: (data) => {
            const d = data as {
              required?: boolean;
              requiredBy?: string;
              supplied?: boolean;
              blobRef?: string;
              employeeId?: string;
              owner?: string;
            };
            if (d.required !== true) return false;
            const from = d.requiredBy ?? d.employeeId ?? d.owner;
            if (person && from !== person) return false;
            // "Supplied" is either the explicit flag or the presence of content.
            const supplied = d.supplied === true || Boolean(d.blobRef);
            return includeSupplied || !supplied;
          },
        });
        ctx.noteAll(
          "document",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        return {
          // Stated in the result as well as the description, because this is
          // the kind of absence a model will otherwise paper over.
          acknowledgementTracking: "not recorded anywhere in this organisation",
          ...shape(rows, (r) => {
            const from = (visible(r.record.requiredBy) ??
              visible(r.record.employeeId) ??
              visible(r.record.owner)) as string | undefined;
            return {
              id: r.nodeId,
              ...safeFields(r.record, ["name", "nodeType", "nodeId", "expiresOn"]),
              requiredFrom: from ? dir.nameOf(from) : undefined,
              supplied: r.record.supplied === true || Boolean(r.record.blobRef),
            };
          }),
        };
      },
    }),
};

export const supportTools: ToolSpec[] = [
  listEquipment,
  equipmentFaults,
  utilityLog,
  listDocuments,
  expiringDocuments,
  requiredDocuments,
  myDay,
  searchMemory,
];
