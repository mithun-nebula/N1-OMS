import type { DomainContext, DomainModule } from "../types";

export const autonomyDomain: DomainModule = {
  id: "autonomy",
  phase: 6,
  register(_ctx: DomainContext) {
    // Phase 6 autonomy is engine-driven (standing rules, graduation, routine watcher).
    // It registers no record operations; the gate already governs every delegated action.
  },
};

export { AutonomyStore } from "./store";
export { AutonomyEngine } from "./engine";
// `compileRule` and its regex are GONE (Phase 4). It understood exactly one
// sentence shape and returned null for everything else — and a rule that
// silently fails to exist is worse than one that refuses out loud.
export { authorRule, fillFormOffline, type AuthorOutcome } from "./author";
export { evaluateSpec } from "./interpret";
export { describeSpec, describeWhen, RULE_EMITTABLE_OPERATIONS } from "./spec";
export type { RuleSpec, RuleWhen, RuleDo, Finding } from "./spec";
export { FiredKeyStore, type FiredKeys } from "./fired";
export { stopAllRules, resumeAllRules, rulesAreStopped } from "./engine";
