import type { OperationCategory } from "../operation/registry";

export type RuleStatus = "supervised" | "graduated" | "suspended";

export interface RuleState {
  ruleId: string;
  author: string;
  opName: string;
  category?: OperationCategory;
  cleanCount: number;
  status: RuleStatus;
  suspendedReason?: string;
}

export interface AutonomyLedger {
  declare(ruleId: string, author: string, opName: string, category?: OperationCategory): RuleState;
  get(ruleId: string): RuleState | undefined;
  set(state: RuleState): void;
  listByAuthor(author: string): RuleState[];
  list(): RuleState[];
}

export interface AutonomyPolicy {
  neverGraduates(category: OperationCategory): boolean;
  hasEarnedRight(ruleId: string, operationName: string): boolean;
  isSuspended(ruleId: string): boolean;
  recordOutcome(
    ruleId: string,
    operationName: string,
    opts: { approved: boolean; edited: boolean; category?: OperationCategory; author: string },
  ): void;
  offerGraduation(ruleId: string, operationName: string): { due: boolean; cleanCount: number };
}

const NEVER_GRADUATE: ReadonlySet<OperationCategory> = new Set([
  "money",
  "people",
  "leaving-org",
]);

const CLEAN_APPROVALS_TO_GRADUATE = 10;

export class SupervisedAutonomyPolicy implements AutonomyPolicy {
  hasEarnedRight(): boolean {
    return false;
  }
  isSuspended(): boolean {
    return false;
  }
  neverGraduates(category: OperationCategory): boolean {
    return NEVER_GRADUATE.has(category);
  }
  recordOutcome(): void {}
  offerGraduation(): { due: boolean; cleanCount: number } {
    return { due: false, cleanCount: 0 };
  }
}

export class GraduatingAutonomyPolicy implements AutonomyPolicy {
  constructor(private readonly ledger: AutonomyLedger) {}

  neverGraduates(category: OperationCategory): boolean {
    return NEVER_GRADUATE.has(category);
  }

  /**
   * An earned right belongs to a rule AND the operation it earned it for.
   *
   * This used to ignore `operationName` entirely, so a rule graduated for
   * `announcement.send` was silently authorised to run all 51 operations —
   * including generic writes to payroll records.
   */
  hasEarnedRight(ruleId: string, operationName: string): boolean {
    const state = this.ledger.get(ruleId);
    if (state?.status !== "graduated") return false;
    return state.opName === operationName;
  }

  isSuspended(ruleId: string): boolean {
    return this.ledger.get(ruleId)?.status === "suspended";
  }

  recordOutcome(
    ruleId: string,
    operationName: string,
    opts: { approved: boolean; edited: boolean; category?: OperationCategory; author: string },
  ): void {
    // Only ever updates a rule that already exists. This used to declare one
    // on first sight, which made confirming your own parked operation an
    // undocumented rule-creation API — a persisted grant of authority that
    // nobody granted.
    const state = this.ledger.get(ruleId);
    if (!state) return;
    if (state.status === "suspended") return;
    if (opts.category && this.neverGraduates(opts.category)) return;
    if (opts.edited) {
      state.cleanCount = 0;
    } else if (opts.approved) {
      state.cleanCount += 1;
    }
    this.ledger.set(state);
  }

  offerGraduation(ruleId: string, _operationName: string): { due: boolean; cleanCount: number } {
    const state = this.ledger.get(ruleId);
    if (!state || state.status !== "supervised") return { due: false, cleanCount: 0 };
    if (state.category && this.neverGraduates(state.category)) return { due: false, cleanCount: state.cleanCount };
    return { due: state.cleanCount >= CLEAN_APPROVALS_TO_GRADUATE, cleanCount: state.cleanCount };
  }
}

/** Money, employment and leaving-the-org can never run unattended. */
export function neverGraduatesCategory(category?: OperationCategory): boolean {
  return category !== undefined && NEVER_GRADUATE.has(category);
}

export function cleanApprovalsToGraduate(): number {
  return CLEAN_APPROVALS_TO_GRADUATE;
}
