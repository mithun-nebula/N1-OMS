import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import type { ActivityLog } from "@/spine/activity-log/types";
import type { PublishBus } from "@/spine/bus";
import type { Spine } from "@/spine/spine";
import * as adapters from "@/spine/adapters";
import type { AutonomyStore } from "./store";
import type { FiredKeys } from "./fired";
import { evaluateSpec } from "./interpret";
import { describeSpec, type RuleSpec } from "./spec";
import {
  cleanApprovalsToGraduate,
  neverGraduatesCategory,
} from "@/spine/gate/autonomy";

export interface RoutineSuggestion {
  id: string;
  actor: ActorId;
  opName: string;
  count: number;
  status: "offered" | "accepted" | "dismissed";
  /** When it was put in front of somebody — the one-a-week cap reads this. */
  offeredAt: string;
}

const ROUTINE_THRESHOLD = 3;

/**
 * How many times one rule may fire in a day.
 *
 * ⚠ A runaway cannot run away. Fire-once already stops a rule repeating itself
 * on the same finding; this bounds the other direction — a rule whose condition
 * suddenly matches four hundred records because somebody imported a
 * spreadsheet. Being told forty things at once is not being told anything.
 *
 * **Hitting the budget is itself worth reporting**, so it is returned from
 * `tick` rather than swallowed. A rule silently truncated is a rule you believe
 * is working.
 */
const DAILY_FIRING_BUDGET = 20;

/**
 * All rules, off.
 *
 * Not per-rule, deliberately: this is the thing you reach for at three in the
 * morning, **before** you know which rule is misbehaving. On `globalThis` for
 * the reason `limiter.ts` and `directory.ts` are — Next.js dev reloads modules,
 * and a switch that resets itself on a reload is not a switch.
 */
const globalForSwitch = globalThis as unknown as { __orgRulesStopped?: boolean };

export function stopAllRules(): void {
  globalForSwitch.__orgRulesStopped = true;
}

export function resumeAllRules(): void {
  globalForSwitch.__orgRulesStopped = false;
}

export function rulesAreStopped(): boolean {
  return globalForSwitch.__orgRulesStopped === true;
}

export class AutonomyEngine {
  /**
   * ⚠ Skips an overlapping tick rather than queueing it.
   *
   * Cheap insurance next to fire-once, but the failure it prevents is ugly: two
   * ticks interleaved both read "not yet fired" for the same finding before
   * either writes, and the rule notifies twice.
   */
  private ticking = false;

  constructor(
    private readonly store: AutonomyStore,
    private readonly spine: Spine,
    private readonly graph: RecordStore,
    private readonly log: ActivityLog,
    private readonly bus: PublishBus,
    private readonly fired?: FiredKeys,
  ) {}

  /**
   * Registering a rule is the **only** place one comes into existence.
   *
   * It used to be created as a side effect of `recordOutcome`, which meant
   * confirming an operation against an unheard-of rule id declared a persisted
   * grant of authority nobody had granted. Declaring it here, deliberately,
   * is what lets `recordOutcome` refuse to invent one.
   */
  /**
   * Registering a rule is the **only** place one comes into existence.
   *
   * ⚠ **It no longer subscribes to the publish bus**, and that is the point of
   * Prompt 3. It used to do this:
   *
   *     this.bus.subscribe(() => this.tick(new Date().toISOString()));
   *
   * A rule fires → `spine.submit` → `publishResult` → `bus.publish` → every
   * listener, including `tick` → every rule re-evaluates. And the condition is
   * still true: a course in review for five days is still in review five days
   * after you have been told about it. `notify.send` publishes, so **it
   * re-triggered itself**.
   *
   * Two accidents hid it: `compileRule` understood one sentence, so almost no
   * rules existed, and the containing rule had never graduated — a supervised
   * rule's emission parks, and a parked operation does not publish. Neither is
   * a design.
   *
   * Rules are **scheduled** now, through `POST /api/autonomy/tick`. A rule about
   * "five days" does not need sub-second latency, and evaluating every rule on
   * every unrelated change was never what anybody wanted.
   */
  registerRule(spec: RuleSpec): void {
    this.store.declareSpec(spec);
  }

  /** Every rule this engine knows, read from the ledger rather than from memory. */
  specs(): RuleSpec[] {
    return this.store.listSpecs();
  }

  async tick(asOf: string): Promise<{
    emitted: number;
    evaluated: number;
    suspended: string[];
    skipped?: string;
    budgetHit: string[];
  }> {
    // All rules, off. Checked first so the switch is immediate rather than
    // "immediate once the current pass finishes".
    if (rulesAreStopped()) {
      return { emitted: 0, evaluated: 0, suspended: [], skipped: "stopped", budgetHit: [] };
    }
    if (this.ticking) {
      return { emitted: 0, evaluated: 0, suspended: [], skipped: "already ticking", budgetHit: [] };
    }
    this.ticking = true;
    try {
      let emitted = 0;
      let evaluated = 0;
      const budgetHit: string[] = [];
      const today = asOf.slice(0, 10);

      for (const spec of this.specs()) {
        const state = this.store.get(spec.id);
        if (state?.status === "suspended") continue;
        evaluated += 1;

        const findings = await evaluateSpec(spec, this.graph, asOf);
        for (const finding of findings) {
          // A rule may only emit the operation it declared. The ledger grants
          // an earned right to a (rule, operation) pair, so a rule emitting
          // anything else would run under a grant never given for it.
          if (state && finding.opName !== state.opName) continue;

          // ⚠ Fire once per finding. This is what makes "tell me when a course
          // crosses five days" mean once, rather than every tick for as long as
          // it stays crossed.
          if (this.fired?.has(spec.id, finding.key)) continue;

          if (this.fired && this.fired.countOn(spec.id, today) >= DAILY_FIRING_BUDGET) {
            if (!budgetHit.includes(spec.id)) budgetHit.push(spec.id);
            break;
          }

          const res = await this.spine.submit(
            adapters.fromStandingRule({
              ruleId: spec.id,
              ruleAuthor: spec.author,
              name: finding.opName,
              args: finding.args,
            }),
          );
          if (res.status === "ran" || res.status === "awaiting-confirmation") {
            emitted += 1;
            // Recorded for BOTH outcomes. A parked emission has already put the
            // finding in front of somebody; re-raising it on the next tick
            // would be the same noise by another route.
            this.fired?.add(spec.id, finding.key, asOf);
          }
        }
      }
      const suspended = await this.suspendSeparated();
      return { emitted, evaluated, suspended, budgetHit };
    } finally {
      this.ticking = false;
    }
  }

  /** What a rule says it does, in the words it will be read back in. */
  describe(ruleId: string): string | undefined {
    const spec = this.store.getSpec(ruleId);
    return spec ? describeSpec(spec) : undefined;
  }

  async suspendSeparated(): Promise<string[]> {
    const suspended: string[] = [];
    for (const state of this.store.list()) {
      if (state.status === "suspended") continue;
      const node = await this.graph.getNode("employee", state.author);
      const employee = node?.data as { status?: string } | undefined;
      if (employee?.status === "separated") {
        state.status = "suspended";
        state.suspendedReason = "author separated";
        this.store.set(state);
        suspended.push(state.ruleId);
      }
    }
    return suspended;
  }

  suspendAuthor(author: ActorId, reason: string): string[] {
    const suspended: string[] = [];
    for (const state of this.store.listByAuthor(author)) {
      if (state.status !== "suspended") {
        state.status = "suspended";
        state.suspendedReason = reason;
        this.store.set(state);
        suspended.push(state.ruleId);
      }
    }
    return suspended;
  }

  /**
   * Graduation is offered, never assumed (appendix B).
   *
   * The threshold used not to be checked here at all —
   * `CLEAN_APPROVALS_TO_GRADUATE` was read only by `offerGraduation`, which
   * decides when to *notify*. So a rule author could graduate their own rule
   * instantly, with zero approvals behind it.
   */
  acceptGraduation(ruleId: string, actor: ActorId): boolean {
    const state = this.store.get(ruleId);
    if (!state || state.author !== actor) return false;
    if (state.status !== "supervised") return false;
    if (neverGraduatesCategory(state.category)) return false;
    if (state.cleanCount < cleanApprovalsToGraduate()) return false;
    state.status = "graduated";
    this.store.set(state);
    return true;
  }

  /**
   * One tap returns a rule to supervised — but only for someone entitled to.
   * The actor was previously accepted and ignored, so anyone could revoke
   * anyone's rule.
   */
  revoke(ruleId: string, actor: ActorId, opts?: { isAdmin?: boolean }): boolean {
    const state = this.store.get(ruleId);
    if (!state) return false;
    if (state.author !== actor && opts?.isAdmin !== true) return false;
    state.status = "supervised";
    state.cleanCount = 0;
    this.store.set(state);
    return true;
  }

  /**
   * A nightly pass over the activity log, offering repeated work back as rules.
   *
   * ── Three rules, and each one is a lesson about noise ───────────────────
   *
   * **1 · A repeated sequence, not a repeated action.** *"Ran `task.create`
   * three times"* is not a routine — everybody creates tasks. What makes it a
   * habit is the same operation against the same subject: *"created a task for
   * Priya titled 'deck'"*.
   *
   * **2 · At least three occurrences across at least three weeks.** Three times
   * in one afternoon is a batch of work, not a habit. The old version counted
   * raw occurrences and would have offered you a rule for a busy Tuesday.
   *
   * **3 · At most one suggestion a week.** **One bad suggestion teaches people
   * to ignore all of them**, and there is no recovering that.
   */
  async detectRoutines(asOf: string = new Date().toISOString()): Promise<RoutineSuggestion[]> {
    const entries = await this.log.query({});
    const seen = new Map<string, { actor: string; opName: string; weeks: Set<string>; count: number }>();

    for (const e of entries) {
      const actor = e.startedBy.actor;
      if (!actor) continue;
      // The SUBJECT, not just the verb. Without it every busy week looks like a
      // routine.
      const subject = subjectOf(e.changes);
      if (!subject) continue;
      const key = `${actor}:${e.operationName}:${subject}`;
      const week = isoWeekOf(e.at);
      const row = seen.get(key) ?? { actor, opName: e.operationName, weeks: new Set<string>(), count: 0 };
      row.weeks.add(week);
      row.count += 1;
      seen.set(key, row);
    }

    const alreadyOffered = this.store.listSuggestions();
    const lastOfferedAt = alreadyOffered
      .map((s) => s.offeredAt)
      .sort()
      .at(-1);
    // Rule 3 — at most one a week, across all rules and everybody.
    if (lastOfferedAt && isoWeekOf(lastOfferedAt) === isoWeekOf(asOf)) {
      return alreadyOffered;
    }

    for (const [key, row] of seen) {
      if (row.count < ROUTINE_THRESHOLD) continue;
      // Rule 2 — spread across weeks, not bunched in an afternoon.
      if (row.weeks.size < ROUTINE_THRESHOLD) continue;
      const id = `suggest_${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
      if (alreadyOffered.some((s) => s.id === id)) continue;
      this.store.putSuggestion({
        id,
        actor: row.actor,
        opName: row.opName,
        count: row.count,
        status: "offered",
        offeredAt: asOf,
      });
      break; // one a week
    }
    return this.store.listSuggestions();
  }

  /**
   * Accepting a suggestion does **not** create a rule.
   *
   * It marks it accepted, and the person then goes through the same authoring
   * path as a rule they typed themselves — read-back included — starting at
   * zero clean approvals like any other. **Nothing is ever automated without an
   * explicit yes.**
   */
  acceptSuggestion(suggestionId: string): boolean {
    const s = this.store.listSuggestions().find((x) => x.id === suggestionId);
    if (!s || s.status !== "offered") return false;
    this.store.putSuggestion({ ...s, status: "accepted" });
    return true;
  }

  /** Used by the durability test, and by anything that offers one directly. */
  async recordSuggestion(s: Omit<RoutineSuggestion, "offeredAt"> & { offeredAt?: string }): Promise<void> {
    this.store.putSuggestion({ ...s, offeredAt: s.offeredAt ?? new Date().toISOString() });
  }

  listRules() {
    const specs = new Map(this.store.listSpecs().map((s) => [s.id, s]));
    return this.store.list().map((state) => ({
      ...state,
      plainLanguage: specs.get(state.ruleId)?.plainLanguage,
      spec: specs.get(state.ruleId),
      reads: specs.get(state.ruleId) ? describeSpec(specs.get(state.ruleId)!) : undefined,
    }));
  }

  listSuggestions() {
    return this.store.listSuggestions();
  }
}

/**
 * What a recorded action was **about**.
 *
 * ⚠ This is what makes a routine a sequence rather than a verb. Keying on the
 * operation name alone would offer you a rule because "you ran `task.create`
 * three times" — everybody creates tasks. What makes it a habit is the same
 * action against the same SUBJECT: *"created a task for Priya titled 'deck'"*.
 *
 * So the identifying fields come out of `changes[0].after`, which is the record
 * as it was written. An action that writes no record has no subject and is not
 * a routine — `notify.send` is the case that matters, and a suggestion of the
 * form "you notify people a lot" is not one anybody wants.
 */
function subjectOf(
  changes: ReadonlyArray<{ nodeType: string; nodeId: string; after?: unknown }>,
): string | undefined {
  const first = changes[0];
  if (!first) return undefined;
  const after = (first.after ?? {}) as Record<string, unknown>;
  const identifying = ["assignedTo", "owner", "employeeId", "title", "name"]
    .map((k) => (after[k] === undefined ? "" : `${k}=${String(after[k])}`))
    .filter(Boolean);
  // The node type alone is too coarse to be a habit, so an action whose record
  // carries nothing identifying is skipped rather than lumped together.
  if (identifying.length === 0) return undefined;
  return `${first.nodeType}|${identifying.join("|")}`;
}

/** `2026-W34`. Weeks rather than days: a habit is a thing that recurs. */
function isoWeekOf(iso: string): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return iso.slice(0, 7);
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dayNumber = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
