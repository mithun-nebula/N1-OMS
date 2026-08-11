import { providers } from "@/config/providers";
import { ask } from "@/domains/assistant/coordinator";
import { DayPlanService } from "@/domains/assistant/day-plan/service";
import { DayPlanStore } from "@/domains/assistant/day-plan/store";
import { getNews } from "@/domains/assistant/news";
import { AutonomyEngine } from "@/domains/autonomy/engine";
import { compileRule } from "@/domains/autonomy/compiler";
import { CourseService } from "@/domains/course/service";
import { OrgMemoryService } from "@/domains/org-memory/service";
import { PeopleRecordService } from "@/domains/people/service";
import { N1ReadThroughService } from "./n1-readthrough";
import { getQuestionLimiter } from "./limiter";
import { buildDemoWorld, type DemoWorld } from "./bootstrap";
import type { Spine } from "@/spine/spine";

const globalForSpine = globalThis as unknown as {
  __orgSpineWorld?: Promise<DemoWorld>;
};

export function getWorld(): Promise<DemoWorld> {
  if (!globalForSpine.__orgSpineWorld) {
    globalForSpine.__orgSpineWorld = buildDemoWorld();
  }
  return globalForSpine.__orgSpineWorld;
}

export async function getSpine(): Promise<Spine> {
  return (await getWorld()).spine;
}

let peopleService: PeopleRecordService | undefined;
let courseService: CourseService | undefined;
let orgMemoryService: OrgMemoryService | undefined;
let dayPlanStore: DayPlanStore | undefined;
let dayPlanService: DayPlanService | undefined;
let n1ReadThrough: N1ReadThroughService | undefined;

export async function getPeopleService(): Promise<PeopleRecordService> {
  if (!peopleService) {
    const { deps } = await getWorld();
    peopleService = new PeopleRecordService(deps.graph, providers().n1);
  }
  return peopleService;
}

export async function getN1ReadThrough(): Promise<N1ReadThroughService> {
  if (!n1ReadThrough) {
    const { deps } = await getWorld();
    n1ReadThrough = new N1ReadThroughService(deps.graph);
  }
  return n1ReadThrough;
}

export async function getCourseService(): Promise<CourseService> {
  if (!courseService) {
    const { deps } = await getWorld();
    courseService = new CourseService(deps.graph, deps.figures);
  }
  return courseService;
}

export async function getOrgMemoryService(): Promise<OrgMemoryService> {
  if (!orgMemoryService) {
    const { deps } = await getWorld();
    orgMemoryService = new OrgMemoryService(deps.graph);
  }
  return orgMemoryService;
}

export async function getDayPlanService(): Promise<DayPlanService> {
  if (!dayPlanService) {
    const world = await getWorld();
    dayPlanStore ??= new DayPlanStore();
    dayPlanService = new DayPlanService(dayPlanStore, {
      graph: world.deps.graph,
      limiter: getQuestionLimiter(),
      actorLookup: () => ({ spine: world.spine }),
    });
  }
  return dayPlanService;
}

export async function assistantAsk(actor: string, message: string) {
  const world = await getWorld();
  return ask(message, {
    actor,
    spine: world.spine,
    graph: world.deps.graph,
    asOf: new Date().toISOString(),
  });
}

export { getNews };

let autonomyEngine: AutonomyEngine | undefined;

export async function getAutonomyEngine(): Promise<AutonomyEngine> {
  if (!autonomyEngine) {
    const world = await getWorld();
    autonomyEngine = new AutonomyEngine(
      world.autonomy,
      world.spine,
      world.deps.graph,
      world.deps.log,
      world.deps.bus,
    );
    const rule = compileRule("if a course sits in review more than 8 days, tell me", "james", "overdue-review");
    if (rule) autonomyEngine.registerRule(rule);
  }
  return autonomyEngine;
}
