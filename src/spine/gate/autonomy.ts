import type { OperationCategory } from "../operation/registry";

export interface AutonomyPolicy {
  hasEarnedRight(ruleId: string, operationName: string): boolean;
  neverGraduates(category: OperationCategory): boolean;
}

const NEVER_GRADUATE: ReadonlySet<OperationCategory> = new Set([
  "money",
  "people",
  "leaving-org",
]);

export class SupervisedAutonomyPolicy implements AutonomyPolicy {
  hasEarnedRight(_ruleId: string, _operationName: string): boolean {
    return false;
  }

  neverGraduates(category: OperationCategory): boolean {
    return NEVER_GRADUATE.has(category);
  }
}

export class GraduatingAutonomyPolicy implements AutonomyPolicy {
  constructor(
    private readonly earned: (ruleId: string, operationName: string) => boolean,
  ) {}

  hasEarnedRight(ruleId: string, operationName: string): boolean {
    return this.earned(ruleId, operationName);
  }

  neverGraduates(category: OperationCategory): boolean {
    return NEVER_GRADUATE.has(category);
  }
}
