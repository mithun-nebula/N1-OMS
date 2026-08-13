"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The one way a page submits an operation.
 *
 * The block this replaces — `fetch("/api/operations", …)` then
 * `router.refresh()` — is copy-pasted about thirty times, and **not one copy
 * handles anything but success**. Today, if the gate parks an action for
 * confirmation (202) or refuses it (403), the button silently does nothing and
 * the user has no idea why.
 *
 * The four outcomes the gate can produce:
 *
 * | HTTP | Status                 | Means                                      |
 * |------|------------------------|--------------------------------------------|
 * | 200  | ran                    | done                                        |
 * | 202  | awaiting-confirmation  | money/people — a human must confirm         |
 * | 403  | forbidden              | refused, and the message must stay opaque   |
 * | 422  | rejected               | arguments missing or invalid                |
 *
 * The 403 message is deliberately not elaborated on: refusal must never reveal
 * whether a record exists (non-negotiable #2).
 */

export type StartKind = "form" | "typed" | "voice";

export interface OperationOutcome {
  status: "ran" | "awaiting-confirmation" | "forbidden" | "rejected" | "error";
  /** Present on `ran` — whatever the handler returned. */
  response?: unknown;
  /** Present on `ran` — the audit entry, needed to offer an undo. */
  activityEntryId?: string;
}

export interface PendingConfirmation {
  pendingId: string;
  prompt: string;
}

interface RunOptions {
  /** Refresh server components after a successful run. Default true. */
  refresh?: boolean;
  /** How the action was started. Default "form". */
  start?: StartKind;
}

interface SubmitResponse {
  status?: string;
  opaqueMessage?: string;
  detail?: string;
  missing?: string[];
  pendingId?: string;
  prompt?: string;
  error?: string;
  result?: { response?: unknown };
  activityEntry?: { id?: string };
}

export function useOperation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(
    null,
  );

  const reset = useCallback(() => {
    setError(null);
    setMissing([]);
    setConfirmation(null);
  }, []);

  const handle = useCallback(
    async (res: Response, refresh: boolean): Promise<OperationOutcome> => {
      let data: SubmitResponse = {};
      try {
        data = (await res.json()) as SubmitResponse;
      } catch {
        // A non-JSON body means something failed before the route ran.
      }

      if (res.status === 202 && data.pendingId) {
        setConfirmation({
          pendingId: data.pendingId,
          prompt: data.prompt ?? "This needs to be confirmed before it runs.",
        });
        return { status: "awaiting-confirmation" };
      }

      if (res.status === 403) {
        // Keep the server's wording. Adding detail here would leak exactly what
        // the opaque refusal exists to hide.
        setError(data.opaqueMessage ?? data.error ?? "That action is not available.");
        return { status: "forbidden" };
      }

      if (res.status === 422) {
        setMissing(data.missing ?? []);
        setError(
          data.detail ??
            (data.missing?.length
              ? `Still needed: ${data.missing.join(", ")}.`
              : "Some details are missing."),
        );
        return { status: "rejected" };
      }

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Nothing was saved.");
        return { status: "error" };
      }

      if (refresh) router.refresh();
      return {
        status: "ran",
        response: data.result?.response,
        activityEntryId: data.activityEntry?.id,
      };
    },
    [router],
  );

  /** Submit an operation. Returns the outcome; also reflected in the state. */
  const run = useCallback(
    async (
      name: string,
      args: Record<string, unknown> = {},
      options: RunOptions = {},
    ): Promise<OperationOutcome> => {
      reset();
      setBusy(true);
      try {
        const res = await fetch("/api/operations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start: options.start ?? "form", name, args }),
        });
        return await handle(res, options.refresh ?? true);
      } catch {
        setError("Could not reach the server. Nothing was saved.");
        return { status: "error" };
      } finally {
        setBusy(false);
      }
    },
    [handle, reset],
  );

  /** Release an operation the gate parked for confirmation. */
  const confirm = useCallback(
    async (options: RunOptions = {}): Promise<OperationOutcome> => {
      if (!confirmation) return { status: "error" };
      const { pendingId } = confirmation;
      setConfirmation(null);
      setBusy(true);
      try {
        const res = await fetch(`/api/operations/${pendingId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        return await handle(res, options.refresh ?? true);
      } catch {
        setError("Could not reach the server. Nothing was saved.");
        return { status: "error" };
      } finally {
        setBusy(false);
      }
    },
    [confirmation, handle],
  );

  /** Walk away from a parked confirmation. Nothing is saved. */
  const cancel = useCallback(() => setConfirmation(null), []);

  return { run, confirm, cancel, reset, busy, error, missing, confirmation };
}
