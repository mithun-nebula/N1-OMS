import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import type { ActivityLog } from "@/spine/activity-log/types";
import type { PublishBus } from "@/spine/bus";
import type { Spine } from "@/spine/spine";
import * as adapters from "@/spine/adapters";
import type { CompiledRule } from "./compiler";
import type { AutonomyStore } from "./store";

export interface RoutineSuggestion {
  id: string;
  actor: ActorId;
  opName: string;
  count: number;
  status: "offered" | "accepted" | "dismissed";
}

const ROUTINE_THRESHOLD = 3;

export class AutonomyEngine {
  private rules: CompiledRule[] = [];
  private suggestions = new Map<string, RoutineSuggestion>();
  private subscribed = false;

  constructor(
    private readonly store: AutonomyStore,
    private readonly spine: Spine,
    private readonly graph: RecordStore,
    private readonly log: ActivityLog,
    private readonly bus: PublishBus,
  ) {}

  registerRule(rule: CompiledRule): void {
    if (!this.rules.find((r) => r.id === rule.id)) this.rules.push(rule);
    if (!this.subscribed) {
      this.bus.subscribe(() => this.tick(new Date().toISOString()));
      this.subscribed = true;
    }
  }

  async tick(asOf: string): Promise<{ emitted: number; suspended: string[] }> {
    let emitted = 0;
    for (const rule of this.rules) {
      const state = this.store.get(rule.id);
      if (state?.status === "suspended") continue;
      const findings = rule.evaluate(this.graph, asOf);
      for (const finding of findings) {
        const op = this.buildOp(rule, finding.opName, finding.args);
        const res = await this.spine.submit(op);
        if (res.status === "ran" || res.status === "awaiting-confirmation") emitted += 1;
      }
    }
    const suspended = this.suspendSeparated();
    return { emitted, suspended };
  }

  private buildOp(rule: CompiledRule, opName: string, args: Record<string, unknown>) {
    return adapters.fromStandingRule({
      ruleId: rule.id,
      ruleAuthor: rule.author,
      name: opName,
      args,
    });
  }

  suspendSeparated(): string[] {
    const suspended: string[] = [];
    for (const state of this.store.list()) {
      if (state.status === "suspended") continue;
      const employee = this.graph.getNode("employee", state.author)?.data as { status?: string } | undefined;
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

  acceptGraduation(ruleId: string, actor: ActorId): boolean {
    const state = this.store.get(ruleId);
    if (!state || state.author !== actor) return false;
    if (state.status !== "supervised") return false;
    state.status = "graduated";
    this.store.set(state);
    return true;
  }

  revoke(ruleId: string, _actor: ActorId): boolean {
    const state = this.store.get(ruleId);
    if (!state) return false;
    state.status = "supervised";
    state.cleanCount = 0;
    this.store.set(state);
    return true;
  }

  detectRoutines(): RoutineSuggestion[] {
    const entries = this.log.query({});
    const counts = new Map<string, number>();
    for (const e of entries) {
      if (e.startedBy.actor) {
        const key = `${e.startedBy.actor}:${e.operationName}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    for (const [key, count] of counts) {
      if (count >= ROUTINE_THRESHOLD) {
        const [actor, opName] = key.split(":");
        const id = `suggest_${actor}_${opName}`;
        if (!this.suggestions.has(id)) {
          this.suggestions.set(id, { id, actor, opName, count, status: "offered" });
        }
      }
    }
    return [...this.suggestions.values()];
  }

  acceptSuggestion(suggestionId: string): boolean {
    const s = this.suggestions.get(suggestionId);
    if (!s || s.status !== "offered") return false;
    s.status = "accepted";
    return true;
  }

  listRules() {
    return this.store.list();
  }

  listSuggestions() {
    return [...this.suggestions.values()];
  }
}
