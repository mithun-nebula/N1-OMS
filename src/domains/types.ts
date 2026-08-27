import type { PublishBus } from "@/spine/bus";
import type { OperationRegistry } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";
import type { FigureStore } from "@/spine/figures/types";
import type { RecordStore } from "@/spine/record/types";
import type { QuestionLimiter } from "@/domains/workplace/shared/limiter";

export interface DomainContext {
  registry: OperationRegistry;
  graph: RecordStore;
  figures: FigureStore;
  bus: PublishBus;
  owners: Map<string, ActorId>;
  /**
   * Who is named ON a record, keyed `nodeType:nodeId`.
   *
   * `owners` answers who a record belongs to; this answers who was told to
   * work on it. A course assigned outside its owner's team circle was
   * invisible to its own assignee without it.
   */
  assigned: Map<string, ActorId[]>;
  teams: Map<ActorId, string>;
  limiter: QuestionLimiter;
}

export interface DomainModule {
  readonly id: string;
  readonly phase: number;
  register(ctx: DomainContext): void;
  seed?(ctx: DomainContext): Promise<void> | void;
}
