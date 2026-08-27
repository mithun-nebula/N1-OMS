/**
 * The live-update hub — the server half of "every open screen follows the brain".
 *
 * One tiny in-process pub/sub. Write paths call `emitChange(area)` after a
 * successful write; `/api/events` subscribes and forwards each area to every
 * connected browser tab as a Server-Sent Event. The tab then re-fetches what it
 * shows through the normal permission-checked reads.
 *
 * ── ⚠ EVENTS CARRY NO DATA, AND THAT IS THE SECURITY MODEL ──────────────────
 *
 * An event is only an area name — "leave", "day-plan", "messages". Never a
 * record, never an id, never an actor. Whatever a screen learns, it learns by
 * re-fetching through the same reads it already uses, so the permission policy
 * decides what each person sees, exactly as if they had pressed reload.
 * Broadcasting to every session is therefore safe: the tap on the shoulder is
 * public, the answer is not.
 *
 * ── Coalescing ──────────────────────────────────────────────────────────────
 *
 * A burst of writes (committing a day is several) is flushed as one batch after
 * ~150ms, so listeners hear one tap, not ten.
 *
 * ── Why `globalThis` ────────────────────────────────────────────────────────
 *
 * Same reason as `runtime.ts`: in dev, route modules can be re-evaluated
 * independently, and an emitter in `/api/operations`' module instance must
 * reach the subscriber in `/api/events`' instance. A process-wide stash is the
 * one object they all share.
 *
 * Single-instance by design for now. A multi-instance deploy (Phase 8) feeds
 * this same hub from Postgres LISTEN/NOTIFY; nothing else changes.
 */

type LiveListener = (areas: string[]) => void;

interface LiveHub {
  listeners: Set<LiveListener>;
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

const globalForLive = globalThis as unknown as { __orgLiveHub?: LiveHub };

function hub(): LiveHub {
  if (!globalForLive.__orgLiveHub) {
    globalForLive.__orgLiveHub = { listeners: new Set(), pending: new Set(), timer: null };
  }
  return globalForLive.__orgLiveHub;
}

const FLUSH_MS = 150;

/** Something in `area` changed. Fire-and-forget; never throws. */
export function emitChange(area: string): void {
  const h = hub();
  h.pending.add(area);
  if (h.timer) return;
  h.timer = setTimeout(() => {
    const areas = [...h.pending];
    h.pending.clear();
    h.timer = null;
    for (const listener of h.listeners) {
      try {
        listener(areas);
      } catch {
        /* a broken listener must not stop the others */
      }
    }
  }, FLUSH_MS);
  // A pending flush must never keep the process alive on shutdown.
  h.timer.unref?.();
}

/** Listen for changes. Returns the unsubscribe. */
export function subscribeChanges(listener: LiveListener): () => void {
  const h = hub();
  h.listeners.add(listener);
  return () => h.listeners.delete(listener);
}

/** For tests and the events route's own health line. */
export function liveListenerCount(): number {
  return hub().listeners.size;
}
