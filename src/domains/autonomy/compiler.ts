import type { RecordStore } from "@/spine/record/types";
import { findStaleCourses } from "@/domains/course/versioning";

export interface CompiledRule {
  id: string;
  author: string;
  plainLanguage: string;
  category: "routine";
  /**
   * The one operation this rule may emit.
   *
   * The ledger grants an earned right to a rule **and an operation**
   * (`RuleState.opName`), but `evaluate` could previously return any operation
   * name it liked — so the grant and the thing being run were unrelated. A rule
   * declares its operation up front and `tick` refuses anything else.
   */
  opName: string;
  evaluate: (graph: RecordStore, asOf: string) => Promise<Array<{ opName: string; args: Record<string, unknown> }>>;
}

export function compileRule(plainLanguage: string, author: string, ruleId: string): CompiledRule | null {
  const text = plainLanguage.toLowerCase();
  const reviewMatch = text.match(/review.*?(\d+)\s*days?|(\d+)\s*days?.*?review/);
  if (text.includes("course") && text.includes("review") && reviewMatch) {
    const days = Number(reviewMatch[1] ?? reviewMatch[2] ?? 5);
    return {
      id: ruleId,
      author,
      plainLanguage,
      category: "routine",
      opName: "announcement.send",
  evaluate: async (graph, asOf) => {
    const stale = await findStaleCourses(graph, asOf, { review: days });
    return stale
      .filter((c) => c.stage === "review")
      .map((c) => ({
        opName: "announcement.send",
        args: {
          message: `${c.title} has been in review for ${c.daysWaiting} days.`,
          to: [author],
        },
      }));
  },
    };
  }
  return null;
}
