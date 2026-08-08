import type { DomainContext, DomainModule } from "../types";

export const assistantDomain: DomainModule = {
  id: "assistant",
  phase: 5,
  register(_ctx: DomainContext) {
    // Phase 5 assistant is service-driven (coordinator, briefing, day-plan).
    // It registers no record operations; the gate already governs every record change.
  },
};

export { ask } from "./coordinator";
export { generateBrief } from "./briefing";
export { getNews } from "./news";
export { enforceAppendixD } from "./appendix-d";
export { DayPlanService } from "./day-plan/service";
export { DayPlanStore } from "./day-plan/store";
