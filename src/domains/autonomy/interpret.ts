import type { RecordStore } from "@/spine/record/types";
import { findStaleCourses } from "@/domains/course/versioning";
import { findExpiringDocuments, requiredVsSupplied } from "@/domains/workplace/documents";
import { directory } from "@/server/directory";
import type { Finding, RuleSpec } from "./spec";

/**
 * The interpreter: a rule's `when` becomes findings.
 *
 * ── ⚠ Pure, and it must stay that way ───────────────────────────────────────
 *
 * **No closure. No model. No `eval`.** This reads a saved form and calls a
 * helper that already exists — that is the whole of it.
 *
 * A model in this loop would give cost that scales with the record count, drift
 * between one run and the next, and a rule nobody can audit because it never
 * runs the same way twice. The model runs **exactly once**, when the rule is
 * written; the saved form then runs identically forever, for free.
 *
 * Every branch below maps to a helper that was already written and already
 * tested for a screen. Nothing here invents a query.
 */
export async function evaluateSpec(
  spec: RuleSpec,
  graph: RecordStore,
  asOf: string,
): Promise<Finding[]> {
  const recipients = spec.do.to === "author" ? [spec.author] : spec.do.to;
  const notify = (key: string, message: string): Finding => ({
    key,
    opName: "notify.send",
    args: { message, to: recipients },
    summary: message,
  });

  switch (spec.when.kind) {
    case "ageing": {
      const { state, days } = spec.when;
      const stale = await findStaleCourses(graph, asOf, { [state]: days } as Record<string, number>);
      return stale
        .filter((c) => c.stage === state)
        .map((c) =>
          notify(
            // ⚠ The fire-once key. Keyed on the course and the THRESHOLD it
            // crossed, never on the day count — otherwise the same course is a
            // fresh finding every single day it stays stale, and "fire once"
            // would mean nothing at all.
            `course:${c.courseId}:${state}:${days}`,
            `${c.title} has been in ${c.stage} for ${c.daysWaiting} days.`,
          ),
        );
    }

    case "expiring": {
      const { withinDays } = spec.when;
      const docs = await findExpiringDocuments(graph, asOf, withinDays);
      return docs.map((d) =>
        notify(
          `document:${d.id}:${withinDays}`,
          `${d.name} expires on ${d.expiresOn} — ${d.daysLeft} days left.`,
        ),
      );
    }

    case "countOver": {
      const { nodeType, per, count, status } = spec.when;
      const rows = await graph.find(nodeType, (n) => {
        const d = n.data as Record<string, unknown>;
        if (status && d.status !== status) return false;
        return Boolean(d[per]);
      });
      const byPerson = new Map<string, number>();
      for (const row of rows) {
        const who = String((row.data as Record<string, unknown>)[per]);
        byPerson.set(who, (byPerson.get(who) ?? 0) + 1);
      }
      const out: Finding[] = [];
      for (const [who, n] of byPerson) {
        if (n <= count) continue;
        out.push(
          notify(
            // Keyed on the person and the threshold, not on `n`. Otherwise
            // going from 11 to 12 open tasks is a brand new finding.
            `over:${nodeType}:${who}:${count}`,
            `${directory().nameOf(who)} has ${n} ${status ?? "open"} ${nodeType}s.`,
          ),
        );
      }
      return out;
    }

    case "absent": {
      const people = await graph.find(spec.when.nodeType, () => true);
      const out: Finding[] = [];
      for (const person of people) {
        const { missing } = await requiredVsSupplied(graph, spec.when.nodeType, person.id);
        for (const name of missing) {
          out.push(
            notify(
              `absent:${spec.when.nodeType}:${person.id}:${name}`,
              `${directory().nameOf(person.id)} has not supplied ${name}.`,
            ),
          );
        }
      }
      return out;
    }
  }
}
