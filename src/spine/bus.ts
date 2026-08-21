import type { ActorId, NodeId } from "./operation/types";

export type NotificationPayload =
  | { kind: "actor"; actor: ActorId; message: string; ref?: { nodeType: string; nodeId: NodeId } }
  | { kind: "broadcast"; message: string; ref?: { nodeType: string; nodeId: NodeId } }
  | { kind: "record"; nodeType: string; nodeId: NodeId; message: string };

export type NotificationListener = (payload: NotificationPayload) => void;

/**
 * One delivered notification.
 *
 * `id` is generated at publish time and never changes. `/api/notifications`
 * used to derive ids from the array index, so an id meant nothing between two
 * requests and there was nowhere to record that something had been read.
 */
export interface StoredNotification {
  id: string;
  at: string;
  payload: NotificationPayload;
  readAt?: string;
}

/**
 * Durable backing for delivered notifications.
 *
 * Writes are fire-and-forget: `publish` is called synchronously from inside
 * `Spine.executeAndRecord`, and a notification that fails to persist must not
 * fail the operation that produced it.
 */
export interface NotificationPersistence {
  append(notification: StoredNotification): Promise<void>;
  loadRecent(limit: number): Promise<StoredNotification[]>;
  markRead(ids: string[], at: string): Promise<void>;
}

let seq = 0;

/**
 * Every other store in the spine takes an optional persistence adapter —
 * `RecordStore`, `ActivityLog`, `FigureStore`, `AutonomyStore`, `DayPlanStore`.
 * The bus was the one holdout, so notifications died with the process and
 * "six people have not acknowledged the new policy" vanished on every deploy.
 */
export class PublishBus {
  private listeners: NotificationListener[] = [];
  private history: StoredNotification[] = [];
  private hydrated = false;

  /** Without persistence the bus is memory-only, as the tests use it. */
  constructor(private readonly persistence?: NotificationPersistence) {}

  subscribe(listener: NotificationListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  publish(payload: NotificationPayload): void {
    seq += 1;
    const stored: StoredNotification = {
      id: `ntf_${Date.now().toString(36)}_${seq.toString(36)}`,
      at: new Date().toISOString(),
      payload,
    };
    this.history.push(stored);
    void this.persistence?.append(stored).catch(() => {});
    for (const listener of this.listeners) {
      listener(payload);
    }
  }

  /** Pull recent notifications back after a restart. Awaited by the route. */
  async load(limit = 200): Promise<void> {
    if (!this.persistence || this.hydrated) return;
    this.hydrated = true;
    const rows = await this.persistence.loadRecent(limit);
    const known = new Set(this.history.map((n) => n.id));
    // Anything published in this process is newer than the snapshot, so the
    // hydrated rows go in front of it rather than over the top.
    this.history = [...rows.filter((r) => !known.has(r.id)), ...this.history];
  }

  markRead(ids: string[]): void {
    const at = new Date().toISOString();
    const wanted = new Set(ids);
    for (const n of this.history) {
      if (wanted.has(n.id) && !n.readAt) n.readAt = at;
    }
    void this.persistence?.markRead(ids, at).catch(() => {});
  }

  published(): NotificationPayload[] {
    return this.history.map((n) => n.payload);
  }

  /** Delivered notifications, newest last, with their ids and read state. */
  delivered(): StoredNotification[] {
    return [...this.history];
  }

  forActor(actor: ActorId): NotificationPayload[] {
    return this.history
      .map((n) => n.payload)
      .filter((p) => p.kind === "actor" && p.actor === actor);
  }

  /** As `forActor`, but carrying ids and read state for the notifications UI. */
  deliveredTo(actor: ActorId): StoredNotification[] {
    return this.history.filter(
      (n) => n.payload.kind === "actor" && n.payload.actor === actor,
    );
  }
}
