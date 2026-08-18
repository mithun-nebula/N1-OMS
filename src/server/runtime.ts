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

/**
 * Await before reading or changing any account.
 *
 * Accounts live in a module-level map in `accounts.ts`, built at import time
 * from `buildDefaultAccounts()` and only replaced with the real rows when
 * `configureAccounts(pool)` runs inside `buildDemoWorld()`.
 *
 * Until that happens the map holds the *defaults* — on a real deployment, the
 * `ORG_BOOTSTRAP_PASSWORD` from `.env`. `/api/auth/login` calls
 * `verifyCredentials()` directly and never touched the world, so after every
 * restart the throwaway bootstrap password worked again, no matter how many
 * times the admin had changed it. Hydration order, not a permissions bug, and
 * invisible in tests because every test builds the world first.
 */
export async function ensureAccountsReady(): Promise<void> {
  await getWorld();
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
    if (!dayPlanStore) {
      // Durable against restarts when the app runs on Postgres; the store
      // itself stays synchronous (writes are fire-and-forget, reads hydrate
      // once per actor-day via load() before anything touches the plan).
      const { PostgresDayPlanPersistence } = await import("./store-pg-dayplan");
      dayPlanStore = new DayPlanStore(
        world.pool ? new PostgresDayPlanPersistence(world.pool) : undefined,
      );
    }
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
