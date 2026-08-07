import type { DomainContext, DomainModule } from "../types";
import { leaveRequestHandler } from "./operations";
import { seedPeople } from "./seed";

export const peopleDomain: DomainModule = {
  id: "people",
  phase: 2,
  register(ctx: DomainContext) {
    ctx.registry.register(leaveRequestHandler(ctx.graph));
  },
  seed(ctx: DomainContext) {
    seedPeople(ctx);
  },
};
