import type { DomainContext, DomainModule } from "../types";
import {
  taskAssignHandler,
  taskCompleteHandler,
  taskCreateHandler,
  taskDeleteHandler,
  taskEditHandler,
} from "./operations";
import { seedTasks } from "./seed";

export const tasksDomain: DomainModule = {
  id: "tasks",
  phase: 4,
  register(ctx: DomainContext) {
    ctx.registry.register(taskCreateHandler(ctx.graph));
    ctx.registry.register(taskAssignHandler(ctx.graph));
    ctx.registry.register(taskCompleteHandler(ctx.graph));
    ctx.registry.register(taskEditHandler(ctx.graph));
    ctx.registry.register(taskDeleteHandler(ctx.graph));
  },
  async seed(ctx: DomainContext) {
    await seedTasks(ctx);
  },
};
