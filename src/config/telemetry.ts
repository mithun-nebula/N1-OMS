import { registerTelemetry } from "ai";
import { OpenTelemetry } from "@ai-sdk/otel";

/**
 * Turn AI SDK tracing on, once.
 *
 * **Forgetting this produces silence, not an error** — which is why it is
 * asserted rather than merely called. The model is the first metered,
 * variable-latency, occasionally-wrong dependency this project has ever had,
 * and it is the only part of the system whose behaviour cannot be read off the
 * source. An untraced one is undebuggable.
 *
 * Idempotent: `instrumentation.ts` calls it at Next.js startup, and the agent
 * calls it defensively in case some other entry point got there first.
 */
let registered = false;

export function ensureTelemetry(): boolean {
  if (registered) return true;
  try {
    registerTelemetry(new OpenTelemetry());
    registered = true;
  } catch (error) {
    // Registering twice is not a failure worth taking the process down for.
    console.warn(
      `[telemetry] could not register AI SDK tracing: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    registered = false;
  }
  return registered;
}

/** Whether tracing is actually on. The assertion half of "register and assert". */
export function telemetryRegistered(): boolean {
  return registered;
}

/** Tests only — lets a case prove the unregistered path as well as the happy one. */
export function resetTelemetryForTests(): void {
  registered = false;
}
