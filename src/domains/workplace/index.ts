import type { DomainContext, DomainModule } from "../types";
import { announcementSendHandler } from "./operations";

export const workplaceDomain: DomainModule = {
  id: "workplace",
  phase: 4,
  register(ctx: DomainContext) {
    ctx.registry.register(announcementSendHandler());
  },
};
