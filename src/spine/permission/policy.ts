import type { ActorId, NodeId, RoleId } from "../operation/types";
import type {
  FieldPolicy,
  PermissionCheckInput,
  PermissionDecision,
  PermissionRule,
  RecordScope,
  RoleProvider,
} from "./types";

const OPEN_ACTIONS = new Set(["view", "create", "edit"]);

export class PermissionPolicy {
  constructor(
    private readonly rules: PermissionRule[],
    private readonly roles: RoleProvider,
    private readonly openNodeTypes: ReadonlySet<string> = new Set(),
    private readonly readOnlyRoles: ReadonlySet<string> = new Set(["intern"]),
  ) {}

  /**
   * Whether this node type is outside the permission system entirely.
   *
   * The common calendar is exempt by design (appendix E3) — it is open to
   * everyone and safeguarded by notify + record + undo instead of by access
   * control. Callers that need to honour that exemption ask here.
   */
  isOpenNodeType(nodeType: string): boolean {
    return this.openNodeTypes.has(nodeType);
  }

  can(input: PermissionCheckInput): PermissionDecision {
    if (
      this.openNodeTypes.has(input.nodeType) &&
      OPEN_ACTIONS.has(input.action)
    ) {
      if (input.action !== "view") {
        const actorRoles = new Set(this.roles.rolesFor(input.actor));
        const isReadOnly = [...this.readOnlyRoles].some((r) =>
          actorRoles.has(r),
        );
        if (isReadOnly) {
          return { allowed: false };
        }
      }
      return { allowed: true };
    }
    const matching = this.matchingRules(input);
    if (matching.length === 0) {
      return { allowed: false };
    }

    // ── One rule must satisfy BOTH the scope and the fields ─────────────────
    //
    // Scope and fields used to be checked with two independent `some(...)`
    // passes, so rule A could satisfy the scope while rule B satisfied the
    // fields — and neither rule permitted the operation on its own.
    //
    // Nothing exploits that today only because almost no role holds two rules
    // on one node type. Person-scoping deliberately creates that shape (an
    // employee will hold a `self` rule and read through an `own-team` one), so
    // this has to be right before those rules exist.
    //
    // Strictly narrowing: with a single matching rule the result is identical.
    const satisfied = matching.some(
      (rule) =>
        (input.recordNodeId === undefined ||
          this.recordInScope({
            actor: input.actor,
            scope: rule.recordScope,
            nodeType: input.nodeType,
            recordNodeId: input.recordNodeId as NodeId,
          })) &&
        (!input.requiredFields?.length ||
          this.fieldsVisible(rule.fields, input.requiredFields)),
    );
    if (!satisfied) {
      return { allowed: false };
    }
    return { allowed: true };
  }

  fieldVisibilityFor(role: RoleId, nodeType: string): FieldPolicy {
    const rule = this.rules.find(
      (r) => r.role === role && r.nodeType === nodeType,
    );
    return rule ? rule.fields : { kind: "per-field", visible: [], restricted: [] };
  }

  effectiveFieldPolicy(actor: ActorId, nodeType: string): FieldPolicy {
    if (this.openNodeTypes.has(nodeType)) {
      return { kind: "all-visible" };
    }
    const actorRoles = new Set(this.roles.rolesFor(actor));
    const applicable = this.rules.filter(
      (r) => actorRoles.has(r.role) && r.nodeType === nodeType,
    );
    if (applicable.length === 0) {
      return { kind: "per-field", visible: [], restricted: [] };
    }
    if (applicable.some((r) => r.fields.kind === "all-visible")) {
      return { kind: "all-visible" };
    }
    const visible = new Set<string>();
    const restrictedAlways = new Set<string>();
    const restrictedSomewhere = new Set<string>();
    for (const rule of applicable) {
      if (rule.fields.kind === "per-field") {
        for (const f of rule.fields.visible) visible.add(f);
        for (const f of rule.fields.restricted) {
          restrictedSomewhere.add(f);
        }
      }
    }
    for (const f of restrictedSomewhere) {
      if (!visible.has(f)) restrictedAlways.add(f);
    }
    return {
      kind: "per-field",
      visible: [...visible],
      restricted: [...restrictedAlways],
    };
  }

  private matchingRules(input: PermissionCheckInput): PermissionRule[] {
    const actorRoles = new Set(this.roles.rolesFor(input.actor));
    return this.rules.filter(
      (rule) =>
        actorRoles.has(rule.role) &&
        rule.nodeType === input.nodeType &&
        rule.actions.includes(input.action),
    );
  }

  private recordInScope(input: {
    actor: string;
    scope: RecordScope;
    nodeType: string;
    recordNodeId: NodeId;
  }): boolean {
    const { scope, recordNodeId, nodeType, actor } = input;
    switch (scope.kind) {
      case "all":
        return true;
      case "explicit":
        return scope.nodeIds.includes(recordNodeId);
      case "self": {
        const owner = this.roles.ownerOf(nodeType, recordNodeId);
        return owner === actor;
      }
      case "own-team": {
        const owner = this.roles.ownerOf(nodeType, recordNodeId);
        if (owner === undefined) return false;
        return this.roles.teamOf(actor).includes(owner);
      }
      case "team-others": {
        const owner = this.roles.ownerOf(nodeType, recordNodeId);
        // Unknown owner fails closed, and the actor's own record is excluded —
        // that exclusion is the whole point of this scope.
        if (owner === undefined || owner === actor) return false;
        return this.roles.teamOf(actor).includes(owner);
      }
    }
  }

  private fieldsVisible(policy: FieldPolicy, required: string[]): boolean {
    if (policy.kind === "all-visible") return true;
    return required.every((field) => policy.visible.includes(field));
  }
}
