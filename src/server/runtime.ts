import { providers } from "@/config/providers";
import { ask } from "@/domains/assistant/coordinator";
import { DayPlanService } from "@/domains/assistant/day-plan/service";
import { DayPlanStore } from "@/domains/assistant/day-plan/store";
import { getNews } from "@/domains/assistant/news";
import { CourseService } from "@/domains/course/service";
import { OrgMemoryService } from "@/domains/org-memory/service";
import { PeopleRecordService } from "@/domains/people/service";
import { getQuestionLimiter } from "./limiter";
import { buildDemoWorld, type DemoWorld } from "./bootstrap";

const globalForSpine = globalThis as unknown as {
  __orgSpineWorld?: DemoWorld;
};

export function getWorld(): DemoWorld {
  if (!globalForSpine.__orgSpineWorld) {
    globalForSpine.__orgSpineWorld = buildDemoWorld();
  }
  return globalForSpine.__orgSpineWorld;
}

export function getSpine() {
  return getWorld().spine;
}

let peopleService: PeopleRecordService | undefined;
let courseService: CourseService | undefined;
let orgMemoryService: OrgMemoryService | undefined;
let dayPlanStore: DayPlanStore | undefined;
let dayPlanService: DayPlanService | undefined;

export function getPeopleService(): PeopleRecordService {
  peopleService ??= new PeopleRecordService(getWorld().deps.graph, providers().n1);
  return peopleService;
}

export function getCourseService(): CourseService {
  courseService ??= new CourseService(getWorld().deps.graph, getWorld().deps.figures);
  return courseService;
}

export function getOrgMemoryService(): OrgMemoryService {
  orgMemoryService ??= new OrgMemoryService(getWorld().deps.graph);
  return orgMemoryService;
}

export function getDayPlanService(): DayPlanService {
  if (!dayPlanService) {
    dayPlanStore ??= new DayPlanStore();
    dayPlanService = new DayPlanService(dayPlanStore, {
      graph: getWorld().deps.graph,
      limiter: getQuestionLimiter(),
      actorLookup: () => ({ spine: getWorld().spine }),
    });
  }
  return dayPlanService;
}

export function assistantAsk(actor: string, message: string) {
  const world = getWorld();
  return ask(message, {
    actor,
    spine: world.spine,
    graph: world.deps.graph,
    asOf: new Date().toISOString(),
  });
}

export { getNews };
