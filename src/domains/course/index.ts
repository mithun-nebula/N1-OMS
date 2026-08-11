import type { DomainContext, DomainModule } from "../types";
import {
  courseAssignStageOwnerHandler,
  courseRestoreVersionHandler,
  courseSetModuleStateHandler,
  courseSetProgressNoteHandler,
  courseUpdateStageHandler,
} from "./operations";
import { seedCourse } from "./seed";

export const courseDomain: DomainModule = {
  id: "course",
  phase: 3,
  register(ctx: DomainContext) {
    ctx.registry.register(courseUpdateStageHandler(ctx.graph));
    ctx.registry.register(courseSetModuleStateHandler(ctx.graph, ctx.figures));
    ctx.registry.register(courseSetProgressNoteHandler(ctx.graph));
    ctx.registry.register(courseAssignStageOwnerHandler(ctx.graph));
    ctx.registry.register(courseRestoreVersionHandler(ctx.graph));
  },
  async seed(ctx: DomainContext) {
    await seedCourse(ctx);
  },
};
