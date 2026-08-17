import type { DomainContext, DomainModule } from "../types";
import {
  employeeUpdateContactHandler,
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
import {
  employeeCreateHandler,
  employeeDeactivateHandler,
  employeeReactivateHandler,
  employeeSetPayHandler,
  employeeUpdateHandler,
} from "./employee";
import {
  attendanceCheckInHandler,
  attendanceCheckOutHandler,
} from "./attendance";
import { seedPeople } from "./seed";

export const peopleDomain: DomainModule = {
  id: "people",
  phase: 2,
  register(ctx: DomainContext) {
    ctx.registry.register(attendanceCheckInHandler(ctx.graph));
    ctx.registry.register(attendanceCheckOutHandler(ctx.graph));
    ctx.registry.register(leaveRequestHandler(ctx.graph, ctx.owners));
    ctx.registry.register(leaveApproveHandler(ctx.graph));
    ctx.registry.register(leaveDeclineHandler(ctx.graph));
    ctx.registry.register(employeeUpdateContactHandler(ctx.graph));
    ctx.registry.register(employeeCreateHandler(ctx.graph));
    ctx.registry.register(employeeUpdateHandler(ctx.graph));
    ctx.registry.register(employeeDeactivateHandler(ctx.graph));
    ctx.registry.register(employeeReactivateHandler(ctx.graph));
    ctx.registry.register(employeeSetPayHandler(ctx.graph));
    ctx.registry.register(joiningStartHandler(ctx.graph));
    ctx.registry.register(joiningCompleteStepHandler(ctx.graph));
    ctx.registry.register(leavingStartHandler(ctx.graph));
    ctx.registry.register(leavingCompleteHandoverHandler(ctx.graph));
    ctx.registry.register(leavingApplySeparationHandler(ctx.graph));
  },
  async seed(ctx: DomainContext) {
    await seedPeople(ctx);
  },
};
