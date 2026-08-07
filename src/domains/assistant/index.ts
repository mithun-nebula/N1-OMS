import type { DomainContext, DomainModule } from "../types";

export const assistantDomain: DomainModule = {
  id: "assistant",
  phase: 5,
  register(_ctx: DomainContext) {
    // Phase 5: coordinator + specialist assistants, daily brief + commitments.
  },
};
