import type { ActorId } from "@/spine/operation/types";

/**
 * A rule, as **data**.
 *
 * ── Why this shape and not a closure ────────────────────────────────────────
 *
 * A rule used to be a `CompiledRule` whose `evaluate` was a JavaScript closure
 * in an in-memory array. `RuleState` persisted the **grant** — who may emit
 * what, and how many clean approvals it has — and nothing anywhere persisted
 * **what the rule watches**. After a restart the ledger knew *"rule R may emit
 * `notify.send`"* and could not tell you what R was for.
 *
 * That is `UndoInfo.revert` versus `undo.plan`, which this codebase solved once
 * already: **a closure dies with the process; a plan survives it.**
 *
 * Three things this buys at once, and the second two are not incidental:
 *
 *  1. a rule survives a restart;
 *  2. a person can **read** what a rule actually does, in the saved form rather
 *     than in code;
 *  3. a rule can be **shown back before it saves**, which is the whole of the
 *     authoring read-back.
 *
 * ── ⚠ A closed list, deliberately ──────────────────────────────────────────
 *
 * `when` has four kinds and no more, each mapped to a helper that already
 * exists and is already tested. **This is not a query language and must not
 * become one.** Anything a sentence needs that is not here, the author refuses
 * — it does not approximate. A rule that fires on the wrong thing forever is
 * worse than no rule.
 */

export type RuleWhen =
  | {
      /** A record that has sat in one state too long. → `findStaleCourses` */
      kind: "ageing";
      nodeType: "course";
      /** The stage it is stuck in — "review", "draft", and so on. */
      state: string;
      days: number;
    }
  | {
      /** Something with an expiry date coming up. → `findExpiringDocuments` */
      kind: "expiring";
      nodeType: "document";
      withinDays: number;
    }
  | {
      /** Somebody holding more than N of something. → `readMany` + count */
      kind: "countOver";
      nodeType: "task";
      /** The field that names whose it is. */
      per: string;
      count: number;
      /** Only rows in this status, if given. */
      status?: string;
    }
  | {
      /** A required document that was never supplied. → `requiredVsSupplied` */
      kind: "absent";
      nodeType: "employee";
    };

/**
 * ⚠ **`notify.send` and nothing else, this phase.**
 *
 * Every other operation acts on somebody. Money and people park anyway, so a
 * rule emitting them is a slower notification with extra steps.
 *
 * And Phase 3 left the sharp question here deliberately: *"four operations hand
 * work to another person and do not propose — a rule that assigns work UNASKED
 * is a different question, and it is Phase 4's."* **The answer is no, for now.**
 * *"Give Arun the review"* typed by you is one thing; a rule handing Arun work
 * every Monday, decided by nobody that morning, is another. Revisit once real
 * rules have run and there is evidence rather than instinct.
 */
export interface RuleDo {
  opName: "notify.send";
  /** `"author"` means the person who wrote the rule. */
  to: "author" | ActorId[];
}

export interface RuleSpec {
  id: string;
  author: ActorId;
  /** What they actually said. Kept so the rule can be read back, not re-parsed. */
  plainLanguage: string;
  when: RuleWhen;
  do: RuleDo;
  createdAt: string;
}

/** The only operation a rule may emit. Named once so a test can assert it. */
export const RULE_EMITTABLE_OPERATIONS: readonly string[] = ["notify.send"];

/**
 * One thing a rule noticed.
 *
 * `key` is the **fire-once identity** — `(ruleId, key)` is what stops a rule
 * telling you the same thing every tick. It has to be derived from the finding
 * itself and be stable across restarts, so it cannot be an index or a
 * timestamp: a course crossing five days is the same finding tomorrow.
 */
export interface Finding {
  key: string;
  opName: string;
  args: Record<string, unknown>;
  /** What to say if this needs describing to a person. */
  summary: string;
}

/** The rule in one sentence, for the read-back and for `/rules`. */
export function describeWhen(when: RuleWhen): string {
  switch (when.kind) {
    case "ageing":
      return `a course sits in ${when.state} for more than ${when.days} days`;
    case "expiring":
      return `a document is within ${when.withinDays} days of expiring`;
    case "countOver":
      return `somebody has more than ${when.count} ${when.status ?? "open"} tasks`;
    case "absent":
      return "a required document has never been supplied";
  }
}

export function describeSpec(spec: RuleSpec): string {
  const who = spec.do.to === "author" ? "you" : spec.do.to.join(", ");
  return `Tell ${who} when ${describeWhen(spec.when)}.`;
}
