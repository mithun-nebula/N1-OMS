import type { RecordStore } from "@/spine/record/types";
import { findStaleCourses } from "@/domains/course/versioning";

export interface CompiledRule {
  id: string;
  author: string;
  plainLanguage: string;
  category: "routine";
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
