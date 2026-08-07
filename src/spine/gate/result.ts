import type { Operation } from "../operation/types";

export type GateOutcome =
  | GateRun
  | GateRejected
  | GateForbidden
  | GateAwaitingConfirmation;

export interface GateRun {
  status: "run";
}

export interface GateRejected {
  status: "rejected";
  missing: string[];
  detail?: string;
}

export interface GateForbidden {
  status: "forbidden";
}

export type ConfirmationReason = "money-or-people" | "never-graduate" | "not-earned";

export interface GateAwaitingConfirmation {
  status: "awaiting-confirmation";
  reason: ConfirmationReason;
  prompt: string;
  preparedOperation: Operation;
}

export const OPAQUE_REFUSAL_MESSAGE =
  "That action is not available.";

export function isOpaqueRefusal(outcome: GateOutcome): boolean {
  return outcome.status === "forbidden";
}
