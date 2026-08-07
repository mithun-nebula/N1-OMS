import type { ActorId, NodeId, RoleId } from "../operation/types";
import type {
  FieldPolicy,
  PermissionCheckInput,
  PermissionDecision,
  PermissionRule,
  RecordScope,
  RoleProvider,
} from "./types";

export class PermissionPolicy {
  constructor(
    private readonly rules: PermissionRule[],
    private readonly roles: RoleProvider,
  ) {}

  can(input: PermissionCheckInput): PermissionDecision {
    const matching = this.matchingRules(input);
    if (matching.length === 0) {
      return { allowed: false };
    }
    if (input.recordNodeId !== undefined) {
      const inScope = matching.some((rule) =>
        this.recordInScope({
          actor: input.actor,
          scope: rule.recordScope,
          nodeType: input.nodeType,
          recordNodeId: input.recordNodeId as NodeId,
        }),
      );
      if (!inScope) {
        return { allowed: false };
      }
    }
    if (input.requiredFields && input.requiredFields.length > 0) {
      const fieldsCovered = matching.some((rule) =>
        this.fieldsVisible(rule.fields, input.requiredFields as string[]),
      );
      if (!fieldsCovered) {
        return { allowed: false };
      }
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
    }
  }

  private fieldsVisible(policy: FieldPolicy, required: string[]): boolean {
    if (policy.kind === "all-visible") return true;
    return required.every((field) => policy.visible.includes(field));
  }
}
