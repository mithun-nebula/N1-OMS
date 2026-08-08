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
export { compileRule, type CompiledRule } from "./compiler";
