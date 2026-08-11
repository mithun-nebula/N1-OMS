import { n1Mode } from "@/config/env";
import { providers } from "@/config/providers";
import { mapN1Record } from "@/domains/people/n1-mapping";
import {
  SUPPORTED_DOCTYPES,
  doctypeForNodeType,
  mappingForNodeType,
  type DoctypeMapping,
  type N1Category,
} from "@/domains/people/n1-doctypes";
import type { RecordNode } from "@/spine/record/types";
import type { RecordStore } from "@/spine/record/types";

/**
 * Generic N1 read-through for any mapped DocType.
 *
 * When `n1Mode() === "live"`, fetches from N1, maps the record into our node shape,
 * caches it in the graph, then returns it. In stub mode, reads straight from the
 * graph (demo seed data). Nothing here bypasses the gate — the spine's `read()`
 * applies field permission on top of whatever this returns.
 */
export class N1ReadThroughService {
  constructor(private readonly graph: RecordStore) {}

  async read(nodeType: string, id: string): Promise<RecordNode | undefined> {
    if (n1Mode() === "live") {
      const doctype = doctypeForNodeType(nodeType);
      if (doctype) {
        const rec = await providers().n1.get(doctype, id);
        if (rec) {
          const mapped = mapN1Record(rec);
          await this.graph.putNode(mapped.nodeType, mapped.nodeId, mapped.data);
        }
      }
    }
    return this.graph.getNode(nodeType, id);
  }

  async list(nodeType: string, filters?: Record<string, unknown>): Promise<RecordNode[]> {
    if (n1Mode() === "live") {
      const doctype = doctypeForNodeType(nodeType);
      if (doctype) {
        const recs = await providers().n1.list(doctype, filters);
        for (const rec of recs) {
          const mapped = mapN1Record(rec);
          await this.graph.putNode(mapped.nodeType, mapped.nodeId, mapped.data);
        }
      }
    }
    return this.graph.find(nodeType as never, () => true);
  }

  /** Group browsing for the /records page. */
  mappingsByCategory(): Record<N1Category, DoctypeMapping[]> {
    const out = {} as Record<N1Category, DoctypeMapping[]>;
    for (const m of SUPPORTED_DOCTYPES) {
      (out[m.category] ??= []).push(m);
    }
    return out;
  }

  mapping(nodeType: string): DoctypeMapping | undefined {
    return mappingForNodeType(nodeType);
  }
}
