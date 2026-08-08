import { InMemoryActivityLog } from "@/spine/activity-log/log";
import { PublishBus } from "@/spine/bus";
import { InMemoryFigureStore } from "@/spine/figures/store";
import { SupervisedAutonomyPolicy } from "@/spine/gate/autonomy";
import { OperationRegistry } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";
import { InMemoryRecordStore } from "@/spine/record/graph";
import { Spine, type SpineDeps } from "@/spine/spine";
import { DOMAINS, type DomainContext } from "@/domains";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { buildDemoPermissionPolicy } from "./policy";
import { getQuestionLimiter } from "./limiter";

export interface DemoWorld {
  spine: Spine;
  deps: SpineDeps;
  registry: OperationRegistry;
  people: Record<string, { name: string; role: string; team?: string }>;
}

export function buildDemoWorld(): DemoWorld {
  const graph = new InMemoryRecordStore();
  const log = new InMemoryActivityLog();
  const figures = new InMemoryFigureStore();
  const bus = new PublishBus();
  const registry = new OperationRegistry();

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
    domain.seed?.(ctx);
    domain.register(ctx);
  }

  const permissions = buildDemoPermissionPolicy(owners, teams);
  const autonomy = new SupervisedAutonomyPolicy();

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

  return { spine, deps, registry, people: DEMO_PEOPLE };
}
