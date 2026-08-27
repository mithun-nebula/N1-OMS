import type { ToolSet } from "ai";
import { buildToolSet, toolNames, type ToolSpec } from "../tools/catalogue";
import type { ToolContext } from "../tools/context";
import { ALL_TOOLS } from "../tools";
import { writeTools } from "../tools/write";

/** Every Phase 3 write tool, by name. */
const WRITE_TOOL_NAMES = writeTools.map((t) => t.name);

/**
 * Which set a specialist is built with.
 *
 * ── The whole idea of Phase 4.5, in two words ───────────────────────────────
 *
 * `ask` is the set a specialist gets when it is answering a question: **its
 * reads, and nothing else.** `act` is the set it gets when the coordinator has
 * routed an instruction to it: its reads **plus its own domain's writes**.
 *
 * Same specialist, two tool sets, chosen by the caller.
 *
 * **Why this is safe.** A question cannot change anything — not because a
 * prompt forbids it, but because when answering a question the write tools are
 * **not in the set.** Structural, not instructed, like every other guarantee in
 * this codebase.
 *
 * ⚠ **The fan-out is only ever `ask`.** `consult_specialists` runs several
 * specialists in parallel, and parallel actors are precisely what the rule
 * "a fan-out can never change anybody's day as a side effect of being asked a
 * question" exists to prevent. **Acting is always a single named specialist,
 * never a fan-out** — see `delegateAction` in `fanout.ts`, which takes one
 * domain and cannot take a list.
 */
export type SpecialistMode = "ask" | "act";

/**
 * The ten specialists.
 *
 * ── Why specialists exist ───────────────────────────────────────────────────
 *
 * Not for parallelism. That is the second-order benefit. The first is that
 * **more tools makes a model worse at choosing**, and every tool definition
 * costs tokens on every single call.
 *
 * 1b measured both. Asked *"who reports to nobody, and what are they working
 * on?"* with all 33 tools in play, the model called `find_people`, then
 * `get_person` **nine times**, then `list_tasks` twice — hit the twelve-step
 * cap, and returned no answer at all. It had not picked the wrong tools; it had
 * picked a strategy that did not fit in its budget. And with 33 definitions
 * re-sent on every step, that one question consumed most of a person's daily
 * token ceiling.
 *
 * A specialist sees about five tools. That is the intervention.
 *
 * ── Why ten, from Phase 3 ───────────────────────────────────────────────────
 *
 * Seven held while the catalogue was 33 read tools. Phase 3 adds 58 write
 * tools, and on the old table Schedule would have carried about 21 and People
 * about 19 — three times the surface either has ever been measured at, and tool
 * selection is where a small model weakens first. `meeting.update` against
 * `calendar.edit`, `leave.approve` against `expense.approve`: those are not
 * hypothetical confusions, they are the ones in the confusion table.
 *
 * So People split into **HR** and **Leave & Expenses**, Schedule into
 * **Meetings** and **Calendar & Events**, and Tasks came out of Courses, where
 * it was never really at home.
 *
 * *Why leave and expenses sit together:* both are "someone asks, someone
 * approves", both are money/people, both propose. A specialist whose every verb
 * behaves the same way is easier to keep honest than one where half park and
 * half do not.
 *
 * ── Why this is one file rather than ten ────────────────────────────────────
 *
 * The plan asked for one file per specialist. A specialist is a name and a list
 * of tool names — ten files of six lines each would scatter a table that is
 * easier to check when it sits in one place, and the thing most worth checking
 * is that **every tool belongs to exactly one domain and none has been
 * forgotten**. There is a test beside this file that asserts precisely that,
 * which is only cheap because the table is here.
 *
 * ── What Phase 4.5 changed here ─────────────────────────────────────────────
 *
 * `writeToolNames`. Phase 3 put every write on the coordinator and said, in as
 * many words, that this was *"the thing to MEASURE rather than guess at"*.
 * Phase 3 then measured it — ~25,000 tokens of tool definitions on every single
 * call, including *"what's on today?"* — and Phase 4.5 acts on the measurement.
 *
 * **A domain's writes now live with the reads that feed them.** That is not
 * only cheaper, it fixes a pairing problem: Phase 2 found `my_day` called
 * immediately before every id-taking write, and Phase 3 found `approve_expense`
 * taking a `claimId` no read tool produced. An id-fetch and the write it feeds
 * belong to the same agent, and now they are.
 */

/**
 * The ten areas.
 *
 * ⚠ **Derived from `domain-ids.ts` rather than written out here**, because a
 * tool schema under `tools/` needs the same list as a runtime value and cannot
 * import this module for it — see the warning on `coordinatorTools` below about
 * keeping one import direction. The union is unchanged; only where the strings
 * live moved.
 */
export type { DomainId } from "./domain-ids";
export { DOMAIN_IDS } from "./domain-ids";
import type { DomainId } from "./domain-ids";

export interface SpecialistDomain {
  id: DomainId;
  /** What this specialist owns, in the words the coordinator will read. */
  covers: string;
  /**
   * Read tool names. About five each; six is the ceiling, and People is the one
   * exception at seven — see the test, which names the reason rather than
   * loosening the rule for everybody.
   *
   * **These are the `ask` set.** A specialist answering a question holds these
   * and `explain_figure`, and there is nothing else in the record.
   */
  toolNames: readonly string[];
  /**
   * Write tool names — **added to the set only in `act` mode.**
   *
   * Deliberately not capped the way `toolNames` is. A read set is a menu the
   * model must choose from on a vague sentence, and 1b measured that choosing
   * gets worse as the menu grows. An act set is reached with an instruction
   * that has already been routed to this domain and usually names its verb, so
   * the choice is a much easier one. The number that matters is still the one
   * any single agent sees, and the largest here is fifteen against the
   * coordinator's old 106.
   */
  writeToolNames: readonly string[];
}

export const DOMAINS: readonly SpecialistDomain[] = [
  {
    id: "hr",
    covers:
      "employees and the directory, who reports to whom, and the joining and leaving checklists",
    toolNames: ["find_people", "get_person", "joining_status", "handover_status"],
    // `set_pay` and every separation verb park under the gate wherever they
    // live — the gate is in the tool, not in the agent holding it. Phase 3
    // proved both parking conditions fire on a delegated start.
    writeToolNames: [
      "create_employee",
      "update_employee",
      "update_contact",
      "deactivate_employee",
      "reactivate_employee",
      "set_pay",
      "start_joining",
      "complete_joining_step",
      "start_leaving",
      "complete_handover",
      "apply_separation",
    ],
  },
  {
    id: "leave-expenses",
    covers: "leave requests and balances, expense claims, and attendance",
    // `attendance` sits here with `list_leave` deliberately: "was Priya in on
    // Tuesday" against "is Priya off on Tuesday" is the sharpest confusable
    // pair in the read catalogue, and a pair that close is better kept inside
    // one specialist, which sees both descriptions side by side.
    toolNames: ["list_leave", "leave_balance", "list_expenses", "attendance"],
    // And the write pair `approve_leave` / `approve_expense` — Phase 3's other
    // named confusion — is now adjudicated by the same specialist that already
    // holds both reads.
    writeToolNames: [
      "approve_leave",
      "decline_leave",
      "request_leave",
      "approve_expense",
      "decline_expense",
      "claim_expense",
      "clock_in",
      "clock_out",
    ],
  },
  {
    id: "meetings",
    covers: "meetings, who is attending, what was decided in them, and room availability",
    toolNames: ["list_meetings", "get_meeting", "room_availability"],
    writeToolNames: [
      "create_meeting",
      "update_meeting",
      "add_meeting_attendee",
      "cancel_meeting",
      "minute_meeting_decisions",
      "complete_meeting_action",
      "book_room",
      "cancel_room_booking",
    ],
  },
  {
    id: "calendar-events",
    covers: "the shared calendar by period, and organisation events and registrations",
    toolNames: ["calendar_month", "list_events", "get_event"],
    // `cancel_meeting` against `cancel_calendar_entry` is the pair Phase 3's
    // live run met as *"cancel Tuesday"*, and it is SPLIT across two
    // specialists on purpose. The model got that one right by asking which was
    // meant, and the coordinator is the only agent that can ask — a specialist
    // handed "cancel Tuesday" would answer for its own half without knowing the
    // other half existed. So the ambiguity has to be resolved before routing,
    // which is exactly where it now is.
    writeToolNames: [
      "create_calendar_entry",
      "edit_calendar_entry",
      "add_people_to_entry",
      "remove_people_from_entry",
      "cancel_calendar_entry",
      "create_event",
      "add_event_task",
      "register_for_event",
      "close_event",
    ],
  },
  {
    id: "courses",
    covers: "the course pipeline, stages, modules, versions, progress and who is assigned",
    toolNames: ["course_progress", "course_assignees", "get_course", "course_versions"],
    writeToolNames: [
      "create_course",
      "assign_course",
      "update_course_stage",
      "assign_stage_owner",
      "set_module_state",
      "set_progress_note",
      "restore_course_version",
      "delete_course",
    ],
  },
  {
    id: "tasks",
    // Out of Courses, where it never really belonged: most tasks have nothing
    // to do with a course, and a specialist asked about the board should not
    // have to read past four course tools to answer.
    covers: "the task board — what is open, who has it, and what is overdue",
    toolNames: ["list_tasks", "get_task"],
    // `delete_task` reads its consequence back before it acts, and Phase 3's
    // live run had it recommend `complete_task` instead. Both are here, so the
    // specialist can still make that swap.
    writeToolNames: [
      "create_task",
      "assign_task",
      "edit_task",
      "start_task",
      "complete_task",
      "delete_task",
    ],
  },
  {
    id: "facilities",
    covers: "the equipment register, faults and repeat failures, and the utilities log",
    toolNames: ["list_equipment", "equipment_faults", "utility_log"],
    writeToolNames: ["report_fault", "capture_utility_reading"],
  },
  {
    id: "documents",
    covers: "the document register, expiry dates and outstanding required paperwork",
    toolNames: ["list_documents", "expiring_documents", "required_documents"],
    writeToolNames: ["store_document", "require_document"],
  },
  {
    id: "day",
    covers:
      "your day plan, the days behind you, the reminders you asked for, and what one team member committed to",
    toolNames: ["my_day", "my_history", "team_day", "my_commitments"],
    // The pairing Phase 2 and Phase 2.5 both measured, finally in one agent.
    // `my_day` was called immediately before every id-taking day write, and
    // `my_commitments` was added in 2.5 precisely because `settle_commitment`
    // took an id nothing produced. Splitting those across two agents would have
    // undone both fixes.
    writeToolNames: [
      "select_item",
      "commit_plan",
      "mark_done",
      "drop_item",
      // The before-the-end check-in ("still on track?"). It sits with the rest
      // of the day writes so the specialist that reads `my_day` for an id can
      // record the answer against that same id in one hop.
      "report_status",
      "carry_over",
      "close_out",
      "remember_commitment",
      "settle_commitment",
    ],
  },
  {
    id: "memory",
    covers: "decisions the organisation recorded, and the reason given at the time",
    toolNames: ["search_memory"],
    writeToolNames: ["log_decision"],
  },
];

/**
 * Tools that belong to no specialist, on purpose.
 *
 * **Figures** — *"why is that 60%?"* is not a domain, it is a question about any
 * number. `explain_figure` is shared, so every specialist can reach it, and the
 * coordinator holds it too: it now carries read tools that return percentages,
 * and a coordinator that cannot explain its own figure would have to fan out to
 * a specialist that never saw the number.
 */
export const SHARED_TOOL_NAMES = ["explain_figure"] as const;

/**
 * The coordinator's hot reads — **derived from the live runs, not chosen.**
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * A read earns a place here **by how often it was actually called**, counted
 * across every live run this project has recorded: 1a (12 questions), 1b (19),
 * Phase 2's real day (19 turns), Phase 2.5 (8), Phase 3 (16 instructions) and
 * Phase 4 (9 exchanges plus 4 controls). Counted by *question reached for*
 * rather than by raw calls, so 1b's pathological nine-in-a-row `get_person`
 * counts once, as the one strategy it was.
 *
 *     my_day           11        list_leave            3
 *     list_tasks        9        attendance            2
 *     get_person        5        course_assignees      2
 *     course_progress   5        search_memory         2
 *     find_people       4        my_commitments        2
 *                                required_documents    2
 *                                expiring_documents    2
 *                                calendar_month        2
 *                                list_meetings         2
 *                                (six more at 1)
 *
 * ── Why six and not eight ───────────────────────────────────────────────────
 *
 * The cap is eight and **two seats are deliberately left empty.** Below three
 * calls the evidence stops separating candidates — seven tools are tied at two,
 * and picking one of them is intuition wearing a measurement's clothes. Handing
 * the coordinator "just a few more" is exactly how it ended up with 106.
 *
 * The empty seats are not a gap to fill by argument. They are filled by the
 * next live run's log, or not at all.
 *
 * ── One adjustment the raw count needs, and it is this phase's own doing ────
 *
 * Most of `my_day`'s eleven and **both** of `my_commitments`' two were
 * id-fetches immediately before a write — Phase 2 says so in as many words.
 * Those calls no longer land here: the write moved into the `day` specialist
 * and the read went with it. So `my_commitments` drops out entirely, having no
 * question-answering call to its name, while `my_day` stays first on either
 * measure because *"what's on me today?"* is the common question this whole
 * phase exists to keep at one call.
 */
export const HOT_READ_TOOL_NAMES = [
  "my_day",
  "list_tasks",
  "get_person",
  "course_progress",
  "find_people",
  "list_leave",
  // ── ⚠ my_memory is the SEVENTH, and it is a named exception ──────────────
  //
  // Every other name above earned its seat BY CALL FREQUENCY, counted from
  // live logs. `my_memory` cannot have: it did not exist, so it has been
  // called zero times, and it will read zero until something writes.
  //
  // It is here on the substitution argument instead, which Phase 4.5 measured
  // twice: A TOOL MOVED OUT OF VIEW IS NOT MERELY SLOWER TO REACH — THE
  // NEAREST THING STILL IN VIEW GETS CALLED INSTEAD. `remember_commitment` out
  // of view became `author_rule`, refused; `drop_item` out of view became
  // `approve_proposal`, failed. Neither was a routing error; the model never
  // considered routing at all.
  //
  // `search_memory` — recorded ORGANISATIONAL decisions, a completely
  // different thing — is already in the coordinator's set. A hidden
  // `my_memory` is that failure waiting to happen, with a tool whose name
  // makes the substitution look right.
  //
  // ⚠ **WHY THIS IS NOT THE DRIFT THE CAP EXISTS TO PREVENT.** Phase 4.5 left
  // NINE tools queued for promotion and named that as a separate decision not
  // to be reached by drift. Those nine are WRITES, and the ceiling they are
  // over is `PROMOTED_WRITE_TOOL_NAMES`, which is at 3 of 3 and untouched by
  // this. This is a read, taking the seventh of eight read seats and the tenth
  // of ten contended ones. The nine remain queued and undecided. See
  // `phases/phase 4.6/outcome.md` §5, where the decision is recorded rather
  // than implied.
  "my_memory",
] as const;

/**
 * Hot reads that no specialist owns.
 *
 * Every other hot read is a DELIBERATE SECOND COPY of a tool a domain also
 * holds -- `my_day` is on the coordinator so "what's on today?" stays one call,
 * and in the `day` specialist so it can fetch the id `mark_done` needs.
 *
 * `my_memory` is not a copy of anything. Memory spans every area, and
 * specialists receive their own domain's facts by injection rather than by
 * holding a tool (`fanout.ts`), so there is no domain to own it.
 *
 * On the letter of the rule it could have gone in `COORDINATOR_ONLY_TOOL_NAMES`
 * with `search` and `who_is_best` -- things with nowhere else to be, which are
 * NOT counted against the cap. **It is counted anyway**, which is the stricter
 * reading and the one that keeps the number meaning something: a tool that can
 * argue its way out of the contended set is how a cap stops counting.
 *
 * Named here, once, because three separate test files assert the "one owner"
 * invariant and a rule remembered in three places is forgotten in the fourth.
 */
export const HOT_READS_WITHOUT_A_DOMAIN: readonly string[] = ["my_memory"];

/**
 * The cap on the coordinator's read tools. **Not negotiable.**
 *
 * A ninth looking necessary is evidence the domain split is wrong somewhere,
 * and it is to be reported as a finding rather than accommodated.
 */
export const HOT_READ_CAP = 8;

/**
 * The ceiling on the contended half of the coordinator's set, under the
 * fallback decided in advance in `implementation-plan.md`.
 *
 * **One budget, not two.** If a write path measures slower than five seconds
 * end to end, up to three writes may be promoted here by the same frequency
 * rule the reads earned their places by — and **a promoted write displaces a
 * read.** Two budgets is how a cap stops meaning anything.
 *
 * If three promotions are not enough, the finding is that the *routing
 * decision* is slow, not the split, and that is separate work with a separate
 * decision behind it. It must not be reached by drift.
 */
export const COORDINATOR_HOT_CEILING = 10;

/**
 * The three writes promoted back, under the fallback decided in advance.
 *
 * ── The trigger fired. Here is the measurement that fired it ────────────────
 *
 * The rule: *a write takes more than five seconds end to end, measured, not
 * felt.* Live, `gemini-3.1-flash-lite` on Vertex, 2026-08-26:
 *
 *     a question, answered directly        median 2.7s
 *     a write, routed to a specialist      median 5.5s   (n=16)
 *     the DAY flow, routed                 median 6.5s   (n=5, ALL over 5s)
 *
 * ── Which three, and why it is not a judgement call ─────────────────────────
 *
 * The rule says the top three **by call frequency**, counted from the live
 * logs — not the three that felt slowest. Across Phase 2's real day and Phase
 * 2.5's runs:
 *
 *     select_item          6        close_out            2
 *     drop_item            6        settle_commitment    2
 *     remember_commitment  3        commit_plan          2
 *     ─────── promoted ───────      mark_done            2
 *                                   carry_over           1
 *
 * ⚠ **And the frequency rule and the live failures agree, which is the only
 * reason this is comfortable.** Each of the three was observed FAILING behind
 * the hop, not merely being slow:
 *
 *   `select_item`         *"Module 4 for an hour…"* then *"commit it"* selected
 *                         all three items a SECOND time. The coordinator could
 *                         not see what its own delegation had already done.
 *   `drop_item`           *"forget the Arun prep"* read the consequence back
 *                         correctly — and then *"yes, drop it"* reached for
 *                         `approve_proposal`, which is the only confirm-shaped
 *                         tool the coordinator holds. Nothing was dropped.
 *                         **Phase 2.5 proved that exact path working.**
 *   `remember_commitment` *"remind me to send the deck on Thursday"* was
 *                         refused — *"I cannot set a one-time reminder"* —
 *                         because the tool that does it was behind the hop and
 *                         `author_rule` was the nearest thing in view.
 *
 * ⚠ **THREE IS NOT ENOUGH, AND THAT IS REPORTED RATHER THAN FIXED HERE.**
 * `commit_plan`, `mark_done`, `carry_over` and `settle_commitment` are still
 * routed and the day flow is still over five seconds. The plan is explicit
 * about what that means — *"more than three means the routing decision is slow,
 * not the split, and the fix is a different one"* — and equally explicit that
 * it must not be reached by drift. So it stops at three. See `outcome.md`.
 */
export const PROMOTED_WRITE_TOOL_NAMES = [
  "select_item",
  "drop_item",
  "remember_commitment",
] as const;

/**
 * What the coordinator holds that no specialist does.
 *
 * Everything here is on the coordinator because **it cannot be routed**, not
 * because it is important.
 */
export const COORDINATOR_ONLY_TOOL_NAMES = [
  // ── Genuinely cross-domain. This is the coordinator's own job. ──────────
  //
  // Features 20 and 21 need People AND Courses at once, which is the exact
  // example feature 01 gives. Making them a specialist would leave the fan-out
  // with nothing to do.
  "who_is_best",
  "capability_gaps",
  // A last resort that competes with everything. Inside a specialist it would
  // sit beside five tools it is worse than.
  "search",
  // Cross-domain by nature: it undoes whatever was last done, in any area, and
  // it inherits the gating of whatever that was.
  "undo_last",

  // ── ⚠ THE PROPOSAL PAIR MUST NOT MOVE. ─────────────────────────────────
  //
  // The propose-gate spans two turns:
  //
  //     turn 1   "approve Priya's leave"  -> a proposal is stored, nothing runs
  //     turn 2   "yes"                    -> approve_proposal submits it by id
  //
  // TURN 2 IS A PLAIN CONVERSATIONAL REPLY. If `approve_proposal` lived inside
  // a specialist, *"yes"* would have to be ROUTED — and the coordinator would
  // have to pick a domain from a word carrying none at all.
  //
  // Phase 3 already found the failure this creates: told *"yes, go ahead"*, the
  // model called `approve_proposal` with a LEAVE id, because it was the only id
  // in front of it. Adding a routing hop to that path makes it worse.
  "approve_proposal",
  "discard_proposal",

  // ── Telling somebody something is not a domain. ────────────────────────
  //
  // These are the two writes with no home in the table, and that is the
  // argument for keeping them here rather than an admission. "Tell Arun the
  // room is booked" carries no domain to route on — it is what the coordinator
  // does AFTER a specialist has reported, in the same turn, and routing it
  // would mean picking a specialist from a sentence that names none.
  //
  // Same shape as the proposal pair, for the same reason.
  "notify_people",
  "send_message",

  // ── Standing rules. ────────────────────────────────────────────────────
  //
  // A rule acts unattended forever, which is the largest thing this product can
  // be asked to do. `author_rule` also holds the question-or-rule ambiguity
  // logic, and that has to run on the ORIGINAL sentence — routing it to a
  // specialist would mean deciding the sentence's domain before deciding
  // whether it is even a rule.
  //
  // And `stop_all_rules` is the switch you reach for at 3am, before you know
  // which rule is misbehaving. It must not be behind a routing hop.
  "author_rule",
  "list_rules",
  "stop_all_rules",
] as const;

/** Every write tool that has been given a home in the table above. */
const DOMAIN_WRITE_NAMES = new Set(DOMAINS.flatMap((d) => [...d.writeToolNames]));

/**
 * Every write tool that is NOT inside a specialist — for the test that asserts
 * the table forgot nothing.
 */
export const UNROUTED_WRITE_NAMES: readonly string[] = WRITE_TOOL_NAMES.filter(
  (n) => !DOMAIN_WRITE_NAMES.has(n),
);

/**
 * The specs for one domain.
 *
 * `ask` — the domain's reads plus the shared figure tool, and **nothing that
 * writes.** `act` — the same, plus this domain's own writes.
 *
 * The default is `ask`, deliberately: a caller that forgets to say which it
 * wants gets the set that cannot change anything.
 */
export function toolsForDomain(id: DomainId, mode: SpecialistMode = "ask"): ToolSpec[] {
  const domain = DOMAINS.find((d) => d.id === id);
  if (!domain) return [];
  const wanted = new Set<string>([
    ...domain.toolNames,
    ...SHARED_TOOL_NAMES,
    ...(mode === "act" ? domain.writeToolNames : []),
  ]);
  return ALL_TOOLS.filter((t) => wanted.has(t.name));
}

/**
 * The coordinator's set, by name.
 *
 * The hot reads, the shared figure tool, and the few things that cannot be
 * routed. `consult_specialists` and `delegate_action` are added by `agent.ts`,
 * because they are built rather than looked up.
 */
export function coordinatorToolNames(): string[] {
  return [
    ...HOT_READ_TOOL_NAMES,
    ...PROMOTED_WRITE_TOOL_NAMES,
    ...SHARED_TOOL_NAMES,
    ...COORDINATOR_ONLY_TOOL_NAMES,
  ];
}

/** The coordinator's specs, in catalogue order. */
export function coordinatorToolSpecs(): ToolSpec[] {
  const wanted = new Set(coordinatorToolNames());
  return ALL_TOOLS.filter((t) => wanted.has(t.name));
}

/** Every domain's line, for the coordinator's tool description. */
export function domainMenu(): string {
  return DOMAINS.map((d) => `- ${d.id}: ${d.covers}`).join("\n");
}

/**
 * Build the coordinator's tool record for one request.
 *
 * ── Why this replaced `toolsFor` in `agent.ts` ──────────────────────────────
 *
 * `toolsFor` returns `ALL_TOOLS`, and that is what put **106 tool definitions —
 * about 26,000 tokens — on every single call**, including *"what's on today?"*.
 * It is the one place in this architecture that contradicts its own evidence:
 * 1b measured that more tools makes a model worse at choosing, which is the
 * entire reason ten specialists exist, and then the coordinator was handed all
 * of them.
 *
 * `toolsFor` is **kept, unchanged**, and still means what it always meant —
 * *everything this person could be offered*. That is what
 * `permission-equivalence.test.ts` needs, and it is not the same question as
 * *what does the coordinator carry*.
 *
 * ⚠ **The builders live here rather than in `tools/index.ts`**, which is where
 * `implementation-plan.md` put them. `domains.ts` already imports `ALL_TOOLS`
 * from `tools/index.ts`, so putting them there makes the two modules import
 * each other. ES modules survive that, but only because nothing touches
 * `ALL_TOOLS` at load time — a fragile property nobody would know they had to
 * preserve. One import direction, kept.
 */
export function coordinatorTools(ctx: ToolContext): { tools: ToolSet; names: string[] } {
  const tools = buildToolSet(ctx, coordinatorToolSpecs());
  return { tools, names: toolNames(tools) };
}

/**
 * Build one specialist's tool record, in the mode the caller asked for.
 *
 * **`ask` cannot write.** Not "refuses to" — there is no write tool in the
 * record, so there is no call to refuse. That is the guarantee, and
 * `modes.test.ts` asserts it for every domain rather than trusting this
 * sentence.
 */
export function specialistTools(
  ctx: ToolContext,
  id: DomainId,
  mode: SpecialistMode,
): { tools: ToolSet; names: string[] } {
  const tools = buildToolSet(ctx, toolsForDomain(id, mode));
  return { tools, names: toolNames(tools) };
}
