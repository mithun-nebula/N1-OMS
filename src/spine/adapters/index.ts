import {
  createOperation,
  type ActorId,
  type Authority,
  type Operation,
  type StartSource,
} from "../operation/types";

export interface PersonStartInput {
  actor: ActorId;
  name: string;
  args: Record<string, unknown>;
  at?: string;
}

export interface AppStartInput {
  ruleId: string;
  ruleAuthor: ActorId;
  name: string;
  args: Record<string, unknown>;
  at?: string;
}

export interface VoiceStartInput extends PersonStartInput {
  transcript: string;
}

export interface ScheduleStartInput extends AppStartInput {
  scheduleId: string;
}

export interface RecordChangeStartInput extends AppStartInput {
  nodeType: string;
  nodeId: string;
}

const now = () => new Date().toISOString();

export function fromForm(input: PersonStartInput): Operation {
  const startedBy: StartSource = {
    kind: "form",
    at: input.at ?? now(),
    actor: input.actor,
  };
  return createOperation({
    name: input.name,
    args: input.args,
    startedBy,
    authority: self(input.actor),
  });
}

export function fromTyped(input: PersonStartInput): Operation {
  const startedBy: StartSource = {
    kind: "typed",
    at: input.at ?? now(),
    actor: input.actor,
  };
  return createOperation({
    name: input.name,
    args: input.args,
    startedBy,
    authority: self(input.actor),
  });
}

export function fromVoice(input: VoiceStartInput): Operation {
  const startedBy: StartSource = {
    kind: "voice",
    at: input.at ?? now(),
    actor: input.actor,
    voiceTranscript: input.transcript,
  };
  return createOperation({
    name: input.name,
    args: input.args,
    startedBy,
    authority: self(input.actor),
  });
}

export function fromSchedule(input: ScheduleStartInput): Operation {
  const startedBy: StartSource = {
    kind: "schedule",
    at: input.at ?? now(),
    scheduleId: input.scheduleId,
  };
  return createOperation({
    name: input.name,
    args: input.args,
    startedBy,
    authority: delegated(input.ruleId, input.ruleAuthor),
  });
}

export function fromRecordChange(input: RecordChangeStartInput): Operation {
  const startedBy: StartSource = {
    kind: "record-change",
    at: input.at ?? now(),
    ruleId: input.ruleId,
    triggeredByRecord: { nodeType: input.nodeType, nodeId: input.nodeId },
  };
  return createOperation({
    name: input.name,
    args: input.args,
    startedBy,
    authority: delegated(input.ruleId, input.ruleAuthor),
  });
}

export function fromStandingRule(input: AppStartInput): Operation {
  const startedBy: StartSource = {
    kind: "standing-rule",
    at: input.at ?? now(),
    ruleId: input.ruleId,
  };
  return createOperation({
    name: input.name,
    args: input.args,
    startedBy,
    authority: delegated(input.ruleId, input.ruleAuthor),
  });
}

export function fromRoutine(input: AppStartInput): Operation {
  const startedBy: StartSource = {
    kind: "routine",
    at: input.at ?? now(),
    ruleId: input.ruleId,
  };
  return createOperation({
    name: input.name,
    args: input.args,
    startedBy,
    authority: delegated(input.ruleId, input.ruleAuthor),
  });
}

function self(actor: ActorId): Authority {
  return { kind: "self", actor };
}

function delegated(ruleId: string, ruleAuthor: ActorId): Authority {
  return { kind: "delegated", ruleId, ruleAuthor };
}

export const ADAPTER_FACTORIES = {
  form: fromForm,
  typed: fromTyped,
  voice: fromVoice,
  schedule: fromSchedule,
  "record-change": fromRecordChange,
  "standing-rule": fromStandingRule,
  routine: fromRoutine,
} as const;
