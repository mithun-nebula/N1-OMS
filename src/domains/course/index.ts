import type { DomainContext, DomainModule } from "../types";
import { courseUpdateStageHandler } from "./operations";
import { seedCourse } from "./seed";

export const courseDomain: DomainModule = {
  id: "course",
  phase: 3,
  register(ctx: DomainContext) {
    ctx.registry.register(courseUpdateStageHandler(ctx.graph));
  },
  seed(ctx: DomainContext) {
    seedCourse(ctx);
  },
};
