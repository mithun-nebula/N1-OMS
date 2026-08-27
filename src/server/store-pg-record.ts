import { Pool } from "pg";
import type { NodeId } from "@/spine/operation/types";
import type {
  EdgeType,
  GraphQuery,
  NodeType,
  RecordData,
  RecordEdge,
  RecordNode,
  RecordStore,
  TraversalDirection,
  TraversalStep,
} from "@/spine/record/types";

/**
 * Durable Postgres RecordStore. Every read/write goes to the database, so data
 * survives restarts. `traverse()` and `find(predicate)` load candidate rows then
 * filter/walk in JS — identical semantics to the in-memory store, just durable.
 *
 * Schema (created in init()):
 *   nodes(type, id, data jsonb, version int, updated_at timestamptz) — PK(type, id)
 *   edges(from_id, to_id, type, data jsonb)
 */
/**
 * ⚠ `timestamptz` comes back from `pg` as a **Date**, not a string.
 *
 * `RecordNode.updatedAt` is typed `string`, and the row type here said so too —
 * so nothing complained while every consumer received an object. Comparing one
 * to an ISO string (`node.updatedAt > committedAt`) then coerces the Date to
 * "Thu Aug 27 2026 …" and compares it lexically against "2026-08-27T…", which
 * is always false. That is how "work assigned after you committed your day"
 * silently found nothing.
 *
 * Normalised here, at the boundary, so the declared type is the truth for
 * everyone downstream rather than something each caller has to know.
 */
function isoOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value);
}

export class PostgresRecordStore implements RecordStore {
  private ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orga_nodes (
        type text NOT NULL,
        id text NOT NULL,
        data jsonb NOT NULL,
        version int NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (type, id)
      );
      CREATE TABLE IF NOT EXISTS orga_edges (
        from_id text NOT NULL,
        to_id text NOT NULL,
        type text NOT NULL,
        data jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS orga_edges_from ON orga_edges (from_id);
      CREATE INDEX IF NOT EXISTS orga_edges_to ON orga_edges (to_id);
      CREATE INDEX IF NOT EXISTS orga_nodes_type ON orga_nodes (type);
    `);
  }

  private async r(): Promise<void> {
    return this.ready;
  }

  async putNode(type: NodeType, id: NodeId, data: RecordData): Promise<RecordNode> {
    await this.r();
    const existing = await this.pool.query<{ version: number }>(
      "SELECT version FROM orga_nodes WHERE type=$1 AND id=$2",
      [type, id],
    );
    const version = (existing.rows[0]?.version ?? 0) + 1;
    const updatedAt = this.now();
    await this.pool.query(
      `INSERT INTO orga_nodes (type, id, data, version, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (type, id) DO UPDATE SET data = EXCLUDED.data, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at`,
      [type, id, JSON.stringify(data), version, updatedAt],
    );
    return { id, type, data: { ...data }, version, updatedAt };
  }

  async getNode(type: NodeType, id: NodeId): Promise<RecordNode | undefined> {
    await this.r();
    const res = await this.pool.query<{ data: RecordData; version: number; updated_at: string }>(
      "SELECT data, version, updated_at FROM orga_nodes WHERE type=$1 AND id=$2",
      [type, id],
    );
    const row = res.rows[0];
    return row ? { id, type, data: row.data, version: row.version, updatedAt: isoOf(row.updated_at) } : undefined;
  }

  async patchNode(type: NodeType, id: NodeId, patch: RecordData): Promise<RecordNode | undefined> {
    const existing = await this.getNode(type, id);
    if (!existing) return undefined;
    const merged = { ...existing.data, ...patch };
    return this.putNode(type, id, merged);
  }

  async removeNode(type: NodeType, id: NodeId): Promise<boolean> {
    await this.r();
    const res = await this.pool.query(
      "DELETE FROM orga_nodes WHERE type=$1 AND id=$2",
      [type, id],
    );
    if (res.rowCount && res.rowCount > 0) {
      await this.pool.query("DELETE FROM orga_edges WHERE from_id=$1 OR to_id=$1", [id]);
      return true;
    }
    return false;
  }

  async addEdge(edge: RecordEdge): Promise<void> {
    await this.r();
    await this.pool.query(
      "INSERT INTO orga_edges (from_id, to_id, type, data) VALUES ($1, $2, $3, $4)",
      [edge.from, edge.to, edge.type, edge.data ? JSON.stringify(edge.data) : null],
    );
  }

  async removeEdge(from: NodeId, to: NodeId, type: EdgeType): Promise<boolean> {
    await this.r();
    const res = await this.pool.query(
      "DELETE FROM orga_edges WHERE from_id=$1 AND to_id=$2 AND type=$3",
      [from, to, type],
    );
    return Boolean(res.rowCount && res.rowCount > 0);
  }

  async edgesOf(nodeId: NodeId, direction: TraversalDirection = "out"): Promise<RecordEdge[]> {
    await this.r();
    const result: RecordEdge[] = [];
    if (direction === "out" || direction === "both") {
      const res = await this.pool.query<{ from_id: string; to_id: string; type: string; data: RecordData }>(
        "SELECT from_id, to_id, type, data FROM orga_edges WHERE from_id=$1",
        [nodeId],
      );
      for (const r of res.rows) result.push({ from: r.from_id, to: r.to_id, type: r.type, data: r.data });
    }
    if (direction === "in" || direction === "both") {
      const res = await this.pool.query<{ from_id: string; to_id: string; type: string; data: RecordData }>(
        "SELECT from_id, to_id, type, data FROM orga_edges WHERE to_id=$1",
        [nodeId],
      );
      for (const r of res.rows) result.push({ from: r.from_id, to: r.to_id, type: r.type, data: r.data });
    }
    return result;
  }

  async traverse(query: GraphQuery): Promise<RecordNode[]> {
    const starts = Array.isArray(query.start) ? query.start : [query.start];
    let frontier = new Set<NodeId>(starts);
    for (const step of query.steps) {
      frontier = await this.advance(frontier, step);
    }
    const result: RecordNode[] = [];
    const seen = new Set<string>();
    for (const id of frontier) {
      const node = await this.nodeByIdAny(id);
      if (node && !seen.has(`${node.type}:${node.id}`)) {
        seen.add(`${node.type}:${node.id}`);
        result.push(node);
      }
    }
    return result;
  }

  async find(type: NodeType, predicate: (node: RecordNode) => boolean): Promise<RecordNode[]> {
    await this.r();
    const res = await this.pool.query<{ id: string; data: RecordData; version: number; updated_at: string }>(
      "SELECT id, data, version, updated_at FROM orga_nodes WHERE type=$1",
      [type],
    );
    const out: RecordNode[] = [];
    for (const row of res.rows) {
      const node: RecordNode = { id: row.id, type, data: row.data, version: row.version, updatedAt: isoOf(row.updated_at) };
      if (predicate(node)) out.push(node);
    }
    return out;
  }

  private async advance(frontier: Set<NodeId>, step: TraversalStep): Promise<Set<NodeId>> {
    const next = new Set<NodeId>();
    const allowed = step.edgeType
      ? new Set(Array.isArray(step.edgeType) ? step.edgeType : [step.edgeType])
      : undefined;
    for (const nodeId of frontier) {
      const edges = await this.edgesOf(nodeId, step.direction ?? "out");
      for (const edge of edges) {
        if (allowed && !allowed.has(edge.type)) continue;
        const target = this.resolveTarget(nodeId, edge, step.direction ?? "out");
        if (!target) continue;
        const node = await this.nodeByIdAny(target);
        if (!node) continue;
        if (step.toNodeType && node.type !== step.toNodeType) continue;
        next.add(target);
      }
    }
    return next;
  }

  private resolveTarget(nodeId: NodeId, edge: RecordEdge, direction: TraversalDirection): NodeId | undefined {
    if (direction === "out") return edge.to;
    if (direction === "in") return edge.from;
    return edge.from === nodeId ? edge.to : edge.from;
  }

  private async nodeByIdAny(id: NodeId): Promise<RecordNode | undefined> {
    await this.r();
    const res = await this.pool.query<{ type: string; data: RecordData; version: number; updated_at: string }>(
      "SELECT type, data, version, updated_at FROM orga_nodes WHERE id=$1 LIMIT 1",
      [id],
    );
    const row = res.rows[0];
    return row ? { id, type: row.type, data: row.data, version: row.version, updatedAt: isoOf(row.updated_at) } : undefined;
  }

  private now(): string {
    return new Date().toISOString();
  }
}
