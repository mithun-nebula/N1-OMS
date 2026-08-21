import type { DomainContext, DomainModule } from "../types";
import {
  courseAssignStageOwnerHandler,
  courseRestoreVersionHandler,
  courseSetModuleStateHandler,
  courseSetProgressNoteHandler,
  courseUpdateStageHandler,
} from "./operations";
import {
  courseAssignHandler,
  courseCreateHandler,
  courseDeleteHandler,
} from "./crud";
import { seedCourse } from "./seed";

export const courseDomain: DomainModule = {
  id: "course",
  phase: 3,
  register(ctx: DomainContext) {
    ctx.registry.register(courseUpdateStageHandler(ctx.graph, ctx.figures));
    ctx.registry.register(courseSetModuleStateHandler(ctx.graph, ctx.figures));
    ctx.registry.register(courseSetProgressNoteHandler(ctx.graph));
    ctx.registry.register(courseAssignStageOwnerHandler(ctx.graph));
    ctx.registry.register(courseRestoreVersionHandler(ctx.graph, ctx.figures));
    ctx.registry.register(courseCreateHandler(ctx.graph, ctx.figures, ctx.owners));
    ctx.registry.register(courseAssignHandler(ctx.graph, ctx.owners));
    ctx.registry.register(courseDeleteHandler(ctx.graph, ctx.owners));
  },
  async seed(ctx: DomainContext) {
    await seedCourse(ctx);
  },
};
