import type { DomainContext, DomainModule } from "../types";
import {
  leaveApproveHandler,
  leaveDeclineHandler,
  leaveRequestHandler,
} from "./operations";
import {
  joiningCompleteStepHandler,
  joiningStartHandler,
} from "./joining";
import {
  leavingApplySeparationHandler,
  leavingCompleteHandoverHandler,
  leavingStartHandler,
} from "./leaving";
import { seedPeople } from "./seed";

export const peopleDomain: DomainModule = {
  id: "people",
  phase: 2,
  register(ctx: DomainContext) {
    ctx.registry.register(leaveRequestHandler(ctx.graph));
    ctx.registry.register(leaveApproveHandler(ctx.graph));
    ctx.registry.register(leaveDeclineHandler(ctx.graph));
    ctx.registry.register(joiningStartHandler(ctx.graph));
    ctx.registry.register(joiningCompleteStepHandler(ctx.graph));
    ctx.registry.register(leavingStartHandler(ctx.graph));
    ctx.registry.register(leavingCompleteHandoverHandler(ctx.graph));
    ctx.registry.register(leavingApplySeparationHandler(ctx.graph));
  },
  seed(ctx: DomainContext) {
    seedPeople(ctx);
  },
};
