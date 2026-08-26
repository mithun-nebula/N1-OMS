import { providers } from "@/config/providers";
import { ask as agentAsk, type AskResult } from "@/domains/assistant/agent";
import { ConversationStore } from "@/domains/assistant/conversation";
import { MemoryStore } from "@/domains/assistant/memory/store";
import { rememberFromTurn } from "@/domains/assistant/memory/extract";
import { localDate } from "@/domains/assistant/day-plan/time";
import { DayPlanService } from "@/domains/assistant/day-plan/service";
import { DayPlanStore } from "@/domains/assistant/day-plan/store";
import { getNews } from "@/domains/assistant/news";
import { setTokenBudgetPersistence } from "@/domains/assistant/token-budget";
import { AutonomyEngine } from "@/domains/autonomy/engine";
import { authorRule } from "@/domains/autonomy/author";
import { FiredKeyStore } from "@/domains/autonomy/fired";
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
    globalForSpine.__orgSpineWorld = buildDemoWorld().then(async (world) => {
      await installProposalStore(world);
      return world;
    });
  }
  return globalForSpine.__orgSpineWorld;
}

/**
 * Prepared operations, shared between instances.
 *
 * ── ⚠ Installed HERE, and not beside `installTokenBudget` ───────────────────
 *
 * The token budget is installed from `assistantAsk`, which is the only path
 * that spends one. A proposal is not like that: it is **created** by chat or by
 * voice, and **spent** by an HTTP tap on `/api/proposals/{id}` — three entry
 * points, on possibly three different instances. Installing it from any one of
 * them would leave the others on the in-memory store, and the symptom would be
 * an Approve button that works or does not depending on which instance answers.
 *
 * `getWorld()` is the one thing all three go through.
 *
 * Without a pool this is a no-op and proposals stay in memory, exactly as they
 * always were — a single process shares its own memory perfectly well.
 */
async function installProposalStore(world: DemoWorld): Promise<void> {
  if (!world.pool) return;
  const { PostgresProposalStore } = await import("./store-pg-proposals");
  const { setProposalStore } = await import("@/domains/assistant/tools/propose");
  setProposalStore(new PostgresProposalStore(world.pool));
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
let messageStore: import("@/domains/messaging/store").MessageStore | undefined;

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

export async function getMessageStore(): Promise<import("@/domains/messaging/store").MessageStore> {
  if (!messageStore) {
    const world = await getWorld();
    // Chat lives outside the operations gate by design (personal
    // communication, not an org record) — same standing as the day plan.
    const { MessageStore } = await import("@/domains/messaging/store");
    const { PostgresMessagePersistence } = await import("./store-pg-messages");
    messageStore = new MessageStore(
      world.pool ? new PostgresMessagePersistence(world.pool) : undefined,
    );
  }
  return messageStore;
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

let commitments: import("@/domains/assistant/commitments/store").CommitmentStore | undefined;

/**
 * Commitments, built and hydrated in one step.
 *
 * `CommitmentStore.create` is async precisely so there is no way to obtain a
 * durable-but-unhydrated one. That pattern is not a style note: it exists
 * because building and hydrating used to be two steps here and `buildDemoWorld`
 * only ever performed the first, so every restart handed everybody a fresh
 * allowance and the promise was quietly broken.
 */
export async function getCommitmentStore() {
  if (!commitments) {
    const world = await getWorld();
    const { CommitmentStore } = await import("@/domains/assistant/commitments/store");
    const { PostgresCommitmentStore } = await import("./store-pg-commitments");
    commitments = await CommitmentStore.create(
      world.pool ? new PostgresCommitmentStore(world.pool) : undefined,
      Object.keys(world.people),
    );
  }
  return commitments;
}

/**
 * The daily token ceiling, made durable.
 *
 * ⚠ **This is a deliberate reversal of a documented choice** — `token-budget.ts`
 * said a restart forgiving somebody's budget was the PREFERRED failure. It was
 * right about restarts and silent about two servers, which each believed
 * nothing had been spent. See that file's header for the trade in full.
 *
 * Installed once, and only when there is a pool: without a database the budget
 * behaves exactly as it always did.
 */
let tokenBudgetInstalled = false;

async function installTokenBudget(): Promise<void> {
  if (tokenBudgetInstalled) return;
  tokenBudgetInstalled = true;
  const world = await getWorld();
  if (!world.pool) return;
  const { PostgresTokenBudgetStore } = await import("./store-pg-token-budget");
  setTokenBudgetPersistence(new PostgresTokenBudgetStore(world.pool));
}

/**
 * What the assistant remembers about how each person works.
 *
 * One store, one table, tagged by domain -- see `memory/store.ts`. Built
 * through the async factory so a durable-but-unhydrated store is
 * unobtainable, exactly as the commitment store is.
 */
let memory: MemoryStore | undefined;

export async function getMemoryStore(): Promise<MemoryStore> {
  if (!memory) {
    const world = await getWorld();
    const { PostgresMemoryStore } = await import("./store-pg-memory");
    memory = await MemoryStore.create(
      world.pool ? new PostgresMemoryStore(world.pool) : undefined,
    );
  }
  return memory;
}

let conversations: ConversationStore | undefined;

export async function getConversationStore(): Promise<ConversationStore> {
  if (!conversations) {
    const world = await getWorld();
    const { PostgresConversationStore } = await import("./store-pg-conversations");
    conversations = new ConversationStore(
      world.pool ? new PostgresConversationStore(world.pool) : undefined,
    );
  }
  return conversations;
}

/**
 * Ask the assistant.
 *
 * The four-regex router this used to call has gone — that keyword matcher is
 * precisely what feature 01 replaces, and keeping it beside a model that reads
 * tool descriptions would mean two different things deciding what a question
 * was about.
 */
export async function assistantAsk(
  actor: string,
  message: string,
  conversationId?: string,
): Promise<AskResult & { conversationId?: string }> {
  const world = await getWorld();
  await installTokenBudget();
  const store = await getConversationStore();
  const history = conversationId ? await store.historyFor(conversationId, actor) : [];

  const result = await agentAsk({
    actor,
    question: message,
    history,
    // ⚠ Not decoration. This is what scopes a read-back to the exchange it was
    // asked in; without it a confirmation leaks between chats. §9c.
    conversationId,
    deps: {
      spine: world.spine,
      graph: world.deps.graph,
      figures: world.deps.figures,
      permissions: world.deps.permissions,
      courses: new CourseService(world.deps.graph, world.deps.figures),
      dayPlan: await getDayPlanService(),
      commitments: await getCommitmentStore(),
      messages: await getMessageStore(),
      autonomy: await getAutonomyEngine(),
      memory: await getMemoryStore(),
      today: localDate,
    },
  });

  if (conversationId) {
    await store.append(conversationId, actor, [
      { role: "user", content: message },
      { role: "assistant", content: result.answer },
    ]);
  }

  // Extraction, AFTER the answer and never awaited.
  //
  // The turn returns first and the write happens behind it: a slow extraction
  // must not delay an answer, and a failed one must not lose one. Skipped
  // entirely when the model is unreachable -- there is nothing to learn from a
  // turn that did not run, and asking a model that just failed to answer is
  // not the moment to ask it something else.
  if (result.source === "llm") {
    void rememberFrom(actor, message, conversationId);
  }

  return { ...result, conversationId };
}

/**
 * Fire the extractor and forget it.
 *
 * Separate so `assistantAsk` stays readable about the one thing that matters
 * here: this is not on the path the answer takes.
 */
async function rememberFrom(
  actor: string,
  message: string,
  conversationId: string | undefined,
): Promise<void> {
  try {
    await rememberFromTurn({
      store: await getMemoryStore(),
      model: providers().llm.languageModel(),
      actor,
      question: message,
      conversationId,
    });
  } catch {
    /* the answer has already gone out; nothing here may disturb it */
  }
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
      // Fire-once keys, durable. Without these a restart re-notifies everything
      // already reported, and `notify.send` cannot be un-sent.
      await (async () => {
        const fired = new FiredKeyStore(world.pool);
        await fired.init();
        return fired;
      })(),
    );
    const demo = await authorRule(
      "tell me when a course sits in review more than 8 days",
      "james",
      "overdue-review",
    );
    if (demo.ok) autonomyEngine.registerRule(demo.spec);
  }
  return autonomyEngine;
}
