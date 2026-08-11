import type { DomainContext } from "../types";
import { courseCompletionFigure, type CourseModule } from "./figures";

interface SeedCourse {
  id: string;
  title: string;
  owner: string;
  stage: string;
  stageEnteredAt: string;
  modules: CourseModule[];
}

const SEED_COURSES: SeedCourse[] = [
  {
    id: "ai-presentations",
    title: "AI for Presentations",
    owner: "priya",
    stage: "review",
    stageEnteredAt: "2026-07-20",
    modules: [
      { name: "Intro", state: "published" },
      { name: "Tools", state: "published" },
      { name: "Slides", state: "published" },
      { name: "Practice", state: "review" },
      { name: "Wrap-up", state: "not-started" },
    ],
  },
  {
    id: "ai-data-analysis",
    title: "AI for Data Analysis",
    owner: "priya",
    stage: "draft",
    stageEnteredAt: "2026-08-01",
    modules: [
      { name: "Intro", state: "published" },
      { name: "Sheets", state: "draft" },
      { name: "Charts", state: "not-started" },
    ],
  },
  {
    id: "spreadsheet-automation",
    title: "Spreadsheet Automation",
    owner: "karthik",
    stage: "outline",
    stageEnteredAt: "2026-08-04",
    modules: [{ name: "Intro", state: "not-started" }],
  },
  {
    id: "ai-basics",
    title: "AI Basics",
    owner: "meena",
    stage: "published",
    stageEnteredAt: "2026-06-01",
    modules: [
      { name: "Intro", state: "published" },
      { name: "Foundations", state: "published" },
    ],
  },
];

export async function seedCourse(ctx: DomainContext): Promise<void> {
  for (const course of SEED_COURSES) {
    ctx.owners.set(`course:${course.id}`, course.owner);
    await ctx.graph.putNode("course", course.id, {
      title: course.title,
      stage: course.stage,
      stageEnteredAt: course.stageEnteredAt,
      owner: course.owner,
      stageOwners: {},
      modules: course.modules,
    });
    await ctx.graph.addEdge({ from: course.owner, to: course.id, type: "writes" });
    await ctx.graph.addEdge({ from: course.owner, to: course.id, type: "owns" });
    await ctx.figures.put(courseCompletionFigure(ctx.figures, course));
  }
}
