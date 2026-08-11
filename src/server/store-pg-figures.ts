import { Pool } from "pg";
import type { NodeId } from "@/spine/operation/types";
import type { Figure, FigurePart, FigureStore } from "@/spine/figures/types";

/**
 * Durable Postgres FigureStore. Every figure (with its computed-from parts) is
 * stored as JSONB so "any figure opens into the parts it was computed from"
 * survives restarts.
 */
export class PostgresFigureStore implements FigureStore {
  private seq = 0;
  private ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orga_figures (
        id text PRIMARY KEY,
        source_type text NOT NULL,
        source_id text NOT NULL,
        label text NOT NULL,
        data jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS orga_figures_source ON orga_figures (source_type, source_id);
    `);
  }

  private async r(): Promise<void> {
    return this.ready;
  }

  async put(figure: Figure): Promise<void> {
    await this.r();
    await this.pool.query(
      `INSERT INTO orga_figures (id, source_type, source_id, label, data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [figure.id, figure.sourceNodeType, figure.sourceNodeId, figure.label, JSON.stringify(figure)],
    );
  }

  async replace(figure: Figure): Promise<void> {
    await this.r();
    // Remove older figures with the same label for this record, then put the new one.
    await this.pool.query(
      "DELETE FROM orga_figures WHERE source_type=$1 AND source_id=$2 AND label=$3",
      [figure.sourceNodeType, figure.sourceNodeId, figure.label],
    );
    await this.put(figure);
  }

  async get(id: string): Promise<Figure | undefined> {
    await this.r();
    const res = await this.pool.query<{ data: Figure }>(
      "SELECT data FROM orga_figures WHERE id=$1",
      [id],
    );
    return res.rows[0]?.data;
  }

  async forRecord(nodeType: string, nodeId: NodeId, label?: string): Promise<Figure[]> {
    await this.r();
    const res = label
      ? await this.pool.query<{ data: Figure }>(
          "SELECT data FROM orga_figures WHERE source_type=$1 AND source_id=$2 AND label=$3",
          [nodeType, nodeId, label],
        )
      : await this.pool.query<{ data: Figure }>(
          "SELECT data FROM orga_figures WHERE source_type=$1 AND source_id=$2",
          [nodeType, nodeId],
        );
    return res.rows.map((r) => r.data);
  }

  async breakdown(id: string): Promise<{ figure: Figure; parts: FigurePart[] } | undefined> {
    const figure = await this.get(id);
    if (!figure) return undefined;
    return { figure, parts: figure.computedFrom };
  }

  nextId(): string {
    this.seq += 1;
    return `fig_${this.seq.toString(36)}`;
  }
}
