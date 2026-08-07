export type ActorId = string;
export type OperationId = string;
export type RoleId = string;
export type NodeId = string;
export type ISODate = string;

export const SEVEN_STARTS = [
  "form",
  "typed",
  "voice",
  "schedule",
  "record-change",
  "standing-rule",
  "routine",
] as const;

export type StartKind = (typeof SEVEN_STARTS)[number];

export const PERSON_STARTS: readonly StartKind[] = ["form", "typed", "voice"];
export const APPLICATION_STARTS: readonly StartKind[] = [
  "schedule",
  "record-change",
  "standing-rule",
  "routine",
];

export interface StartSource {
  kind: StartKind;
  at: ISODate;
  actor?: ActorId;
  ruleId?: string;
  scheduleId?: string;
  voiceTranscript?: string;
  triggeredByRecord?: { nodeType: string; nodeId: NodeId };
}

export type Authority =
  | { kind: "self"; actor: ActorId }
  | { kind: "delegated"; ruleId: string; ruleAuthor: ActorId };

export type RunsUnder =
  | { mode: "own-hand" }
  | { mode: "delegated-capped"; ruleId: string; cappedBy: ActorId };

export interface Operation<TArgs = Record<string, unknown>> {
  id: OperationId;
  name: string;
  args: TArgs;
  startedBy: StartSource;
  authority: Authority;
  runsUnder: RunsUnder;
}

export function resolveRunsUnder(authority: Authority): RunsUnder {
  if (authority.kind === "self") {
    return { mode: "own-hand" };
  }
  return {
    mode: "delegated-capped",
    ruleId: authority.ruleId,
    cappedBy: authority.ruleAuthor,
  };
}

export function createOperation<TArgs>(
  input: {
    id?: OperationId;
    name: string;
    args: TArgs;
    startedBy: StartSource;
    authority: Authority;
  },
): Operation<TArgs> {
  return {
    id: input.id ?? generateOperationId(),
    name: input.name,
    args: input.args,
    startedBy: input.startedBy,
    authority: input.authority,
    runsUnder: resolveRunsUnder(input.authority),
  };
}

let counter = 0;
export function generateOperationId(): OperationId {
  counter += 1;
  return `op_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function isPersonStart(kind: StartKind): boolean {
  return PERSON_STARTS.includes(kind);
}

export function isApplicationStart(kind: StartKind): boolean {
  return APPLICATION_STARTS.includes(kind);
}
