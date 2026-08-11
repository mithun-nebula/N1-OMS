import { InMemoryActivityLog } from "@/spine/activity-log/log";
import { PublishBus } from "@/spine/bus";
import { InMemoryFigureStore } from "@/spine/figures/store";
import { GraduatingAutonomyPolicy } from "@/spine/gate/autonomy";
import { AutonomyStore } from "@/domains/autonomy/store";
import { OperationRegistry } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";
import { InMemoryRecordStore } from "@/spine/record/graph";
import type { FigureStore } from "@/spine/figures/types";
import type { ActivityLog } from "@/spine/activity-log/types";
import type { RecordStore } from "@/spine/record/types";
import { Spine, type SpineDeps } from "@/spine/spine";
import { DOMAINS, type DomainContext } from "@/domains";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { buildDemoPermissionPolicy } from "./policy";
import { getQuestionLimiter } from "./limiter";
import { PostgresRecordStore } from "./store-pg-record";
import { PostgresActivityLog } from "./store-pg-activity";
import { PostgresFigureStore } from "./store-pg-figures";
import { configureAccounts } from "./accounts";
import { seedN1DemoIfEmpty } from "@/domains/people/n1-demo-seed";
import {
  recordCreateHandler,
  recordUpdateHandler,
  recordDeleteHandler,
} from "@/domains/shared/record-ops";

export interface DemoWorld {
  spine: Spine;
  deps: SpineDeps;
  registry: OperationRegistry;
  autonomy: AutonomyStore;
  people: Record<string, { name: string; role: string; team?: string }>;
}

/** Returns a shared Postgres pool when DATABASE_URL is set, else undefined. */
function pgPool(): import("pg").Pool | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {}
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);
  return new Pool({
    connectionString: url,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  });
}

export async function buildDemoWorld(): Promise<DemoWorld> {
  const pool = pgPool();
  const graph: RecordStore = pool ? new PostgresRecordStore(pool) : new InMemoryRecordStore();
  const log: ActivityLog = pool ? new PostgresActivityLog(pool) : new InMemoryActivityLog();
  const figures: FigureStore = pool ? new PostgresFigureStore(pool) : new InMemoryFigureStore();
  const bus = new PublishBus();
  const registry = new OperationRegistry();

  // Durable accounts (hydrate from DB / seed defaults)
  await configureAccounts(pool);

  const owners = new Map<string, ActorId>();
  const teams = new Map<ActorId, string>();

  const ctx: DomainContext = {
    registry,
    graph,
    figures,
    bus,
    owners,
    teams,
    limiter: getQuestionLimiter(),
  };

  for (const domain of DOMAINS) {
    domain.register(ctx);
  }
  ctx.registry.register(recordCreateHandler(ctx.graph));
  ctx.registry.register(recordUpdateHandler(ctx.graph));
  ctx.registry.register(recordDeleteHandler(ctx.graph));
  await seedIfEmpty(ctx, graph);
  await seedN1DemoIfEmpty(ctx);
  await hydrateOwners(owners, graph);

  const permissions = buildDemoPermissionPolicy(owners, teams);
  const autonomyStore = new AutonomyStore(pool);
  await autonomyStore.init();
  const autonomy = new GraduatingAutonomyPolicy(autonomyStore);

  const deps: SpineDeps = {
    operations: registry,
    permissions,
    autonomy,
    log,
    graph,
    figures,
    bus,
  };
  const spine = new Spine(deps);

  return { spine, deps, registry, autonomy: autonomyStore, people: DEMO_PEOPLE };
}

/**
 * Seed guard: only seed demo data on a first/empty run. With a durable store
 * (Postgres) this means real data survives restarts — we never re-seed over it.
 */
async function seedIfEmpty(ctx: DomainContext, graph: RecordStore): Promise<void> {
  const existing = await graph.find("employee", () => true);
  if (existing.length > 0) return;
  for (const domain of DOMAINS) {
    await domain.seed?.(ctx);
  }
}

/**
 * Rebuild the owners map from persisted course nodes. Without this, the
 * permission policy's ownerOf() returns undefined for courses after a restart
 * (seed was skipped → owners map empty), breaking self/own-team scope.
 */
async function hydrateOwners(owners: Map<string, ActorId>, graph: RecordStore): Promise<void> {
  const courses = await graph.find("course", () => true);
  for (const c of courses) {
    const owner = (c.data as { owner?: string }).owner;
    if (owner) owners.set(`course:${c.id}`, owner);
  }
}
