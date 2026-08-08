import type { OperationCategory } from "@/spine/operation/registry";
import type { AutonomyLedger, RuleState } from "@/spine/gate/autonomy";

export class AutonomyStore implements AutonomyLedger {
  private rules = new Map<string, RuleState>();

  declare(
    ruleId: string,
    author: string,
    opName: string,
    category?: OperationCategory,
  ): RuleState {
    const existing = this.rules.get(ruleId);
    if (existing) return existing;
    const state: RuleState = {
      ruleId,
      author,
      opName,
      category,
      cleanCount: 0,
      status: "supervised",
    };
    this.rules.set(ruleId, state);
    return state;
  }

  get(ruleId: string): RuleState | undefined {
    return this.rules.get(ruleId);
  }

  set(state: RuleState): void {
    this.rules.set(state.ruleId, state);
  }

  listByAuthor(author: string): RuleState[] {
    return [...this.rules.values()].filter((r) => r.author === author);
  }

  list(): RuleState[] {
    return [...this.rules.values()];
  }
}
