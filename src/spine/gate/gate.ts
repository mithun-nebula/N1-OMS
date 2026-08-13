import { flattenRequirements, type OperationRegistry } from "../operation/registry";
import type { Authority, Operation } from "../operation/types";
import { isApplicationStart } from "../operation/types";
import type { PermissionPolicy } from "../permission/policy";
import type { AutonomyPolicy } from "./autonomy";
import type { GateAwaitingConfirmation, GateOutcome } from "./result";

/**
 * The gate's checks, in the order they actually run.
 *
 * Permission comes first, ahead of argument validation — see the comment in
 * `evaluate`. A rejection's `detail` describes records, so it cannot be
 * produced for someone who has not first been shown to be allowed to see them.
 */
const CHECK_ORDER = [
  "role-record-field",
  "arguments-valid",
  "rule-suspended",
  "money-or-people",
  "never-graduate",
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

  async evaluate(operation: Operation): Promise<GateOutcome> {
    const handler = this.operations.require(operation.name);
    const actor = effectiveActor(operation.authority);

    // ── Permission BEFORE validation ────────────────────────────────────────
    //
    // The documented order puts arguments first, and for a permitted caller
    // that is still what they experience. But a rejection carries `detail`,
    // and `detail` describes records: "No employee X", "X is already inactive",
    // "James still manages 5 people (Priya, Arun, …)". Returning that to
    // someone who is not allowed to see the record hands them existence, state
    // and relationships — exactly what the opaque refusal exists to hide
    // (non-negotiable #2).
    //
    // So permission is decided first, and someone who fails it learns nothing
    // beyond "not available". Someone who passes it gets the same helpful
    // validation messages as before.
    let requirements;
    try {
      requirements = flattenRequirements(await handler.permission(operation.args));
    } catch {
      // A handler that cannot even describe what it needs from these arguments
      // must not fall through to a permitted state.
      return { status: "forbidden" };
    }

    const allowed = requirements.every((req) => {
      if (req.allowedActors?.includes(actor)) return true;
      return this.permissions
        .can({
          actor,
          action: req.action,
          nodeType: req.nodeType,
          recordNodeId: req.recordNodeIds?.[0],
          requiredFields: req.fields,
        })
        .allowed;
    });
    if (!allowed) {
      return { status: "forbidden" };
    }

    const validation = await handler.validate(operation.args);
    if (!validation.ok) {
      return {
        status: "rejected",
        missing: validation.missing,
        detail: validation.detail,
      };
    }

    const delegated = operation.authority.kind === "delegated";

    if (delegated) {
      const ruleId = operation.authority.kind === "delegated" ? operation.authority.ruleId : "";
      if (this.autonomy.isSuspended(ruleId)) {
        return { status: "forbidden" };
      }
    }

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
