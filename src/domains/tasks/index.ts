import type { DomainContext, DomainModule } from "../types";
import { taskAssignHandler, taskCompleteHandler, taskCreateHandler } from "./operations";
import { seedTasks } from "./seed";

export const tasksDomain: DomainModule = {
  id: "tasks",
  phase: 4,
  register(ctx: DomainContext) {
    ctx.registry.register(taskCreateHandler(ctx.graph));
    ctx.registry.register(taskAssignHandler(ctx.graph));
    ctx.registry.register(taskCompleteHandler(ctx.graph));
  },
  seed(ctx: DomainContext) {
    seedTasks(ctx);
  },
};
