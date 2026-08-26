import type { ActorId } from "@/spine/operation/types";
import { directory } from "@/server/directory";
import { providers } from "@/config/providers";
import { sanitizeForAppendixD } from "../appendix-d";
import type { DayPlanService, CarriedItem } from "./service";
import type { DayPlan } from "./store";
import { shortfallOf } from "./store";

/**
 * The morning brief, as a conversation rather than a slideshow.
 *
 * ── What this replaces, and what it deliberately does not ───────────────────
 *
 * `briefItems()` turns the three bands into a wizard: fixed text, fixed buttons
 * (*Got it* · *Handle / Later* · *Open / Dismiss*), one item at a time. That is
 * a form rendered as a conversation, and in chat it reads like one — you cannot
 * answer two things in a sentence, which is the entire point of chat.
 *
 * **`briefItems()` stays.** The dashboard uses it and the clock-in popup is
 * deferred UI, not deleted UI. Two surfaces over one set of bands.
 *
 * ── The rule this file exists to obey ───────────────────────────────────────
 *
 * **Gather deterministically, narrate with the model — never the reverse.**
 *
 * Phase 1a proved why. Told not to invent *records*, the model invented a
 * *date* instead — *"August 11–17, 2025"*, in the wrong year, under a
 * conclusion that happened to be right. So every number below — how many days
 * overdue, how many minutes left, which meetings, who needs approving — is
 * computed here. The model receives them already decided and writes the
 * sentence around them. It is never asked what is at risk.
 *
 * `generateBrief` is not replaced, not re-implemented, and its three bands
 * arrive already permission-filtered per record.
 */

export interface BriefMeeting {
  title: string;
  startsAt?: string;
  /** Local clock time, computed here so the model never formats a date. */
  at?: string;
}

export interface BriefContext {
  date: string;
  actor: ActorId;
  name: string;
  /** Committed today and not yet done — the thing you were already mid-way through. */
  inProgress: Array<{ label: string; minutesLeft: number }>;
  /** Owed from previous days, oldest debt first. Carries `overdueDays`. */
  overdue: CarriedItem[];
  /** Today's diary. */
  meetings: BriefMeeting[];
  /** Waiting on this person — pending approvals and the like. */
  needsYou: string[];
  /** Stale courses, documents running out. */
  atRisk: string[];
  /** Offered by last night's close-out. Suggestions, never commitments. */
  suggested: string[];
  /**
   * Things they explicitly asked to be reminded of, due today or overdue.
   *
   * Explicit only. Nothing here was inferred from a turn of phrase — being
   * chased about something you never promised is worse than not being reminded.
   */
  commitments: Array<{ id: string; what: string; dueDate: string; overdue: boolean }>;
  /** True when the day is already committed — the brief is then a recap. */
  alreadyCommitted: boolean;
}

/** Local clock time from an ISO instant. Formatted here, never by the model. */
function clockOf(iso?: string): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Everything the brief needs, gathered from code.
 *
 * Nothing here asks a model anything.
 */
export async function gatherBrief(
  service: DayPlanService,
  actor: ActorId,
  date: string,
  opts: {
    commitments?: Array<{ id: string; what: string; dueDate: string }>;
  } = {},
): Promise<BriefContext> {
  const store = service.getStore();
  await store.load(actor, date);
  let plan: DayPlan | undefined = store.get(actor, date);

  // `startDay` is what builds the bands and the seeds. Idempotent for a day
  // already under way — it returns the existing plan rather than rebuilding.
  if (!plan) {
    const opened = await service.startDay(actor, date);
    plan = opened.plan ?? store.get(actor, date);
  }

  // Presenting the whole brief IS answering it — see `markBriefDelivered`.
  // Without this the phase stays at `briefing` and every `select_item` from
  // chat is refused, which is exactly what a real morning found.
  if (plan?.phase === "briefing") plan = service.markBriefDelivered(actor, date);

  const overdue = await service.carriedWork(actor, date);

  const inProgress = (plan?.plan ?? [])
    .filter((p) => !p.done && !p.dropped)
    .map((p) => ({ label: p.label, minutesLeft: shortfallOf(p) }));

  const meetings = (plan?.meetings ?? [])
    .map((m) => ({ title: m.title, startsAt: m.start, at: clockOf(m.start) }))
    .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));

  return {
    date,
    actor,
    name: directory().nameOf(actor),
    inProgress,
    overdue,
    meetings,
    needsYou: plan?.brief.needsYou ?? [],
    atRisk: plan?.brief.atRisk ?? [],
    suggested: plan?.suggested ?? [],
    commitments: (opts.commitments ?? []).map((c) => ({
      ...c,
      overdue: c.dueDate < date,
    })),
    alreadyCommitted: plan?.phase === "planned",
  };
}

/**
 * The brief in plain sentences, without a model.
 *
 * Not a placeholder — this is the outage path, and it is the same shape
 * `course/service.ts:generateDeck` established: try the provider, fall back to
 * something deterministic, and report which one ran. Feature 03 promises the
 * manual screens always work; this is that promise for the brief.
 *
 * It is also the reference for what the narrated version must not add.
 */
export function plainBrief(ctx: BriefContext): string {
  const lines: string[] = [];

  // Settled order: in progress -> overdue -> meetings -> what else.
  if (ctx.inProgress.length > 0) {
    const bits = ctx.inProgress.map((i) =>
      i.minutesLeft > 0 ? `${i.label} (${i.minutesLeft}m left)` : i.label,
    );
    lines.push(`Still on today: ${bits.join(", ")}.`);
  }

  for (const item of ctx.overdue) {
    if (item.overdueDays > 1) {
      lines.push(
        `${item.label} is ${item.overdueDays} days overdue${item.interrupted ? " — it was interrupted" : ""}.`,
      );
    } else {
      lines.push(
        item.interrupted
          ? `${item.label} was interrupted yesterday and is still open.`
          : `${item.label} is still open from yesterday.`,
      );
    }
  }

  for (const line of ctx.needsYou) lines.push(line);

  if (ctx.meetings.length > 0) {
    const bits = ctx.meetings.map((m) => (m.at ? `${m.at} ${m.title}` : m.title));
    lines.push(`In the diary: ${bits.join(", ")}.`);
  }

  for (const line of ctx.atRisk) lines.push(line);

  for (const c of ctx.commitments) {
    lines.push(
      c.overdue
        ? `You asked to be reminded: ${c.what} — that was due ${c.dueDate}.`
        : `You asked to be reminded: ${c.what}.`,
    );
  }

  if (ctx.suggested.length > 0) {
    lines.push(`You said you would pick up: ${ctx.suggested.join(", ")}.`);
  }

  lines.push(
    ctx.alreadyCommitted
      ? "Your day is already committed. Anything to add?"
      : "What are you taking on today?",
  );

  return lines.join("\n");
}

const NARRATOR = [
  "You are writing one person's morning brief, in two or three short sentences.",
  "",
  "EVERYTHING YOU NEED IS BELOW AND IT IS ALREADY DECIDED. Do not add a fact, a",
  "name, a number, a date or a time that is not in it, and do not work any date",
  "out — the days-overdue counts and the clock times are given to you.",
  "",
  "Lead with anything overdue, then the diary, then ask what they are taking on",
  "today. Say the number of days for anything overdue by more than one.",
  "Work already part done keeps its remaining minutes.",
  "",
  "ONLY the `overdue` list is overdue. Items under `atRisk` are things that have",
  "been sitting a while — a course waiting in review, a document nearing its",
  "date. Repeat those as they are written and do NOT call them overdue: nothing",
  "there has missed a deadline, and saying it has is inventing a fact.",
  "",
  "Comment on the work, never on the person, and never compare anyone with",
  "anyone. Do not encourage, do not sympathise, do not tell them how to feel",
  "about their day. Be brief and plain, and end with the question.",
].join("\n");

export interface BriefResult {
  opening: string;
  context: BriefContext;
  /** Which path produced the wording — the same honesty `generateDeck` has. */
  source: "llm" | "plain";
}

/**
 * The brief, narrated if a model is available and plainly if not.
 *
 * Every sentence passes `sanitizeForAppendixD` on the way out. This is where
 * Phase 2 starts generating far more prose about somebody's work than Phase 1
 * ever did, and the filter is not weakened to suit it — if a line is blocked,
 * the wording changes.
 */
export async function briefFor(
  service: DayPlanService,
  actor: ActorId,
  date: string,
  opts: {
    commitments?: Array<{ id: string; what: string; dueDate: string }>;
  } = {},
): Promise<BriefResult> {
  const context = await gatherBrief(service, actor, date, opts);
  const plain = plainBrief(context);

  try {
    const llm = providers().llm;
    const narrated = await llm.complete(
      [
        `Today is ${date}. The person is ${context.name}.`,
        "",
        "THE FACTS, already decided:",
        JSON.stringify(
          {
            stillOnToday: context.inProgress,
            overdue: context.overdue.map((o) => ({
              what: o.label,
              daysOverdue: o.overdueDays,
              minutesLeft: o.minutesLeft,
              interrupted: o.interrupted,
            })),
            waitingOnYou: context.needsYou,
            meetings: context.meetings.map((m) => ({ at: m.at, title: m.title })),
            atRisk: context.atRisk,
            youAskedToBeReminded: context.commitments,
            youSaidYouWouldPickUp: context.suggested,
            dayAlreadyCommitted: context.alreadyCommitted,
          },
          null,
          1,
        ),
      ].join("\n"),
      { system: NARRATOR },
    );
    // The morning brief is COACHING prose, so it keeps the full strict set —
    // including the time-of-day pattern that the scheduling surface drops.
    // This is the surface that pattern was written for.
    const clean = sanitizeForAppendixD(narrated.trim(), "coaching");
    // An empty or filtered-away narration falls back rather than shipping a
    // refusal sentence as somebody's morning brief.
    if (clean.length > 0 && !clean.startsWith("I can only comment on your work")) {
      return { opening: clean, context, source: "llm" };
    }
  } catch {
    // No provider, or it is unreachable. The plain brief is a real brief.
  }

  return { opening: plain, context, source: "plain" };
}
