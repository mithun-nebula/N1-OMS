import type { DomainContext, DomainModule } from "../types";
import { orgMemoryRecordHandler } from "./operations";
import { seedOrgMemory } from "./seed";

export const orgMemoryDomain: DomainModule = {
  id: "org-memory",
  phase: 3,
  register(ctx: DomainContext) {
    ctx.registry.register(orgMemoryRecordHandler(ctx.graph));
  },
  seed(ctx: DomainContext) {
    seedOrgMemory(ctx);
  },
};
