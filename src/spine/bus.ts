import type { ActorId, NodeId } from "./operation/types";

export type NotificationPayload =
  | { kind: "actor"; actor: ActorId; message: string; ref?: { nodeType: string; nodeId: NodeId } }
  | { kind: "broadcast"; message: string; ref?: { nodeType: string; nodeId: NodeId } }
  | { kind: "record"; nodeType: string; nodeId: NodeId; message: string };

export type NotificationListener = (payload: NotificationPayload) => void;

export class PublishBus {
  private listeners: NotificationListener[] = [];
  private history: NotificationPayload[] = [];

  subscribe(listener: NotificationListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  publish(payload: NotificationPayload): void {
    this.history.push(payload);
    for (const listener of this.listeners) {
      listener(payload);
    }
  }

  published(): NotificationPayload[] {
    return [...this.history];
  }

  forActor(actor: ActorId): NotificationPayload[] {
    return this.history.filter(
      (p) => p.kind === "actor" && p.actor === actor,
    );
  }
}
