import type { DomainContext } from "../types";
import { courseCompletionFigure, type CourseModule } from "./figures";

interface SeedCourse {
  id: string;
  title: string;
  owner: string;
  stage: string;
  modules: CourseModule[];
}

const SEED_COURSES: SeedCourse[] = [
  {
    id: "ai-presentations",
    title: "AI for Presentations",
    owner: "priya",
    stage: "review",
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
    modules: [{ name: "Intro", state: "not-started" }],
  },
  {
    id: "ai-basics",
    title: "AI Basics",
    owner: "meena",
    stage: "published",
    modules: [
      { name: "Intro", state: "published" },
      { name: "Foundations", state: "published" },
    ],
  },
];

export function seedCourse(ctx: DomainContext): void {
  for (const course of SEED_COURSES) {
    ctx.owners.set(`course:${course.id}`, course.owner);
    ctx.graph.putNode("course", course.id, {
      title: course.title,
      stage: course.stage,
      owner: course.owner,
      modules: course.modules,
    });
    ctx.graph.addEdge({ from: course.owner, to: course.id, type: "writes" });
    ctx.graph.addEdge({ from: course.owner, to: course.id, type: "owns" });
    ctx.figures.put(courseCompletionFigure(ctx.figures, course));
  }
}
