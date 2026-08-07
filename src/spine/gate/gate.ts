import { flattenRequirements, type OperationRegistry } from "../operation/registry";
import type { Authority, Operation } from "../operation/types";
import { isApplicationStart } from "../operation/types";
import type { PermissionPolicy } from "../permission/policy";
import type { AutonomyPolicy } from "./autonomy";
import type { GateAwaitingConfirmation, GateOutcome } from "./result";

const CHECK_ORDER = [
  "arguments-valid",
  "role-record-field",
  "person-asked-now",
  "money-or-people",
  "earned-right",
  "run",
] as const;

export { CHECK_ORDER };

export class GateEngine {
  constructor(
    private readonly operations: OperationRegistry,
    private readonly permissions: PermissionPolicy,
    private readonly autonomy: AutonomyPolicy,
  ) {}

  evaluate(operation: Operation): GateOutcome {
    const handler = this.operations.require(operation.name);

    const validation = handler.validate(operation.args);
    if (!validation.ok) {
      return {
        status: "rejected",
        missing: validation.missing,
        detail: validation.detail,
      };
    }

    const actor = effectiveActor(operation.authority);
    const requirements = flattenRequirements(handler.permission(operation.args));
    const allowed = requirements.every((req) =>
      this.permissions
        .can({
          actor,
          action: req.action,
          nodeType: req.nodeType,
          recordNodeId: req.recordNodeIds?.[0],
          requiredFields: req.fields,
        })
        .allowed,
    );
    if (!allowed) {
      return { status: "forbidden" };
    }

    const delegated = operation.authority.kind === "delegated";

    if (handler.involvesMoneyOrPeople(operation.args) && delegated) {
      return awaiting(operation, "money-or-people", moneyOrPeoplePrompt(operation));
    }

    const category = handler.category;
    if (delegated && category && this.autonomy.neverGraduates(category)) {
      return awaiting(operation, "never-graduate", neverGraduatePrompt(operation));
    }

    if (delegated) {
      const ruleId = operation.authority.kind === "delegated" ? operation.authority.ruleId : "";
      if (!this.autonomy.hasEarnedRight(ruleId, operation.name)) {
        return awaiting(operation, "not-earned", notEarnedPrompt(operation));
      }
    }

    return { status: "run" };
  }
}

export function effectiveActor(authority: Authority): string {
  return authority.kind === "self" ? authority.actor : authority.ruleAuthor;
}

function awaiting(
  operation: Operation,
  reason: GateAwaitingConfirmation["reason"],
  prompt: string,
): GateAwaitingConfirmation {
  return {
    status: "awaiting-confirmation",
    reason,
    prompt,
    preparedOperation: operation,
  };
}

function moneyOrPeoplePrompt(operation: Operation): string {
  return `This action involves money or people, so it needs your confirmation before it runs. (${operation.name})`;
}

function neverGraduatePrompt(operation: Operation): string {
  return `This action can never run automatically — it always needs a person to confirm it. (${operation.name})`;
}

function notEarnedPrompt(operation: Operation): string {
  return `This rule has not yet earned the right to act alone — it needs your approval. (${operation.name})`;
}

export { isApplicationStart };
