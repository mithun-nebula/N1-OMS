import type { DomainContext, DomainModule } from "../types";
import { announcementAckHandler, announcementSendHandler } from "./announcements";
import {
  calendarAddPeopleHandler,
  calendarCancelHandler,
  calendarCreateHandler,
  calendarEditHandler,
  calendarRemovePeopleHandler,
} from "./calendar";
import {
  meetingCompleteActionHandler,
  meetingRecordDecisionsHandler,
} from "./decisions";
import { documentRequireHandler, documentStoreHandler } from "./documents";
import {
  equipmentReportFaultHandler,
} from "./equipment";
import {
  eventAddTaskHandler,
  eventCloseHandler,
  eventCreateHandler,
  eventRegisterHandler,
} from "./events";
import {
  meetingAddAttendeeHandler,
  meetingCancelHandler,
  meetingCreateHandler,
  meetingUpdateHandler,
} from "./meetings";
import { roomBookHandler, roomCancelHandler } from "./rooms";
import { utilityCaptureHandler } from "./utilities";
import { seedWorkplace } from "./seed";

export const workplaceDomain: DomainModule = {
  id: "workplace",
  phase: 4,
  register(ctx: DomainContext) {
    ctx.registry.register(roomBookHandler(ctx.graph));
    ctx.registry.register(roomCancelHandler(ctx.graph));
    ctx.registry.register(meetingCreateHandler(ctx.graph));
    ctx.registry.register(meetingUpdateHandler(ctx.graph));
    ctx.registry.register(meetingAddAttendeeHandler(ctx.graph));
    ctx.registry.register(meetingCancelHandler(ctx.graph));
    ctx.registry.register(calendarCreateHandler(ctx.graph));
    ctx.registry.register(calendarEditHandler(ctx.graph));
    ctx.registry.register(calendarAddPeopleHandler(ctx.graph));
    ctx.registry.register(calendarRemovePeopleHandler(ctx.graph));
    ctx.registry.register(calendarCancelHandler(ctx.graph));
    ctx.registry.register(meetingRecordDecisionsHandler(ctx.graph));
    ctx.registry.register(meetingCompleteActionHandler(ctx.graph));
    ctx.registry.register(eventCreateHandler(ctx.graph));
    ctx.registry.register(eventAddTaskHandler(ctx.graph));
    ctx.registry.register(eventRegisterHandler(ctx.graph));
    ctx.registry.register(eventCloseHandler(ctx.graph));
    ctx.registry.register(utilityCaptureHandler(ctx.graph, ctx.limiter));
    ctx.registry.register(equipmentReportFaultHandler(ctx.graph));
    ctx.registry.register(documentStoreHandler(ctx.graph));
    ctx.registry.register(documentRequireHandler(ctx.graph));
    ctx.registry.register(announcementSendHandler(ctx.graph));
    ctx.registry.register(announcementAckHandler(ctx.graph));
  },
  async seed(ctx: DomainContext) {
    await seedWorkplace(ctx);
  },
};

export { monthView } from "./calendar";
export { findExpiringDocuments, requiredVsSupplied } from "./documents";
export { findOverdueEventTasks, registrationPacing } from "./events";
export { nonAcknowledgers } from "./announcements";
export { repeatFaults } from "./equipment";
