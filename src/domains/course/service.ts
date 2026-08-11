import { providers } from "@/config/providers";
import type { FigureStore } from "@/spine/figures/types";
import type { RecordStore, RecordNode } from "@/spine/record/types";
import { findStaleCourses } from "./versioning";

export interface CourseProgress {
  id: string;
  title: string;
  stage: string;
  owner?: string;
  stageOwners?: Record<string, string>;
  progressNote?: { text: string; at: string; by: string };
  completion: { value: number; unit?: string; explainer: string } | null;
  stale: boolean;
  daysWaiting?: number;
}

export class CourseService {
  constructor(
    private readonly graph: RecordStore,
    private readonly figures: FigureStore,
  ) {}

  getCourse(courseId: string): Promise<RecordNode | undefined> {
    return this.graph.getNode("course", courseId);
  }

  async listProgress(asOf: string = new Date().toISOString()): Promise<CourseProgress[]> {
    const stale = await findStaleCourses(this.graph, asOf);
    const staleMap = new Map(stale.map((s) => [s.courseId, s]));
    const courses = await this.graph.find("course", () => true);
    return Promise.all(courses.map((c) => this.toProgress(c, staleMap)));
  }

  async getProgress(courseId: string, asOf: string = new Date().toISOString()): Promise<CourseProgress | undefined> {
    const node = await this.graph.getNode("course", courseId);
    if (!node) return undefined;
    const stale = await findStaleCourses(this.graph, asOf);
    const staleMap = new Map(stale.map((s) => [s.courseId, s]));
    return this.toProgress(node, staleMap);
  }

  async generateDeck(input: { courseId?: string; topic?: string }): Promise<{
    topic: string;
    slides: Array<{ title: string; bullets: string[] }>;
    format: string;
    renderer: string;
    source: "llm" | "heuristic";
  }> {
    const node = input.courseId ? await this.graph.getNode("course", input.courseId) : undefined;
    const data = node?.data as { title?: string; modules?: Array<{ name: string }> } | undefined;
    const topic = input.topic ?? data?.title ?? "Untitled";
    const system =
      "You produce presentation outlines as JSON: an array of objects {title, bullets:[...]}. No prose outside the JSON.";
    const prompt = `Produce a 6-10 slide outline for a course titled "${topic}".` +
      (data?.modules ? ` Cover these modules: ${data.modules.map((m) => m.name).join(", ")}.` : "");
    let slides: Array<{ title: string; bullets: string[] }> | undefined;
    let source: "llm" | "heuristic" = "heuristic";
    try {
      const raw = await providers().llm.complete(prompt, { system });
      slides = parseSlides(raw);
      if (slides) source = "llm";
    } catch {
      slides = undefined;
    }
    if (!slides) slides = heuristicOutline(topic, data?.modules ?? []);
    return { topic, slides, format: "org-outline", renderer: "docx-pdf-deferred", source };
  }

  private async toProgress(node: RecordNode, staleMap: Map<string, { daysWaiting: number }>): Promise<CourseProgress> {
    const data = node.data as {
      title?: string;
      stage?: string;
      owner?: string;
      stageOwners?: Record<string, string>;
      progressNote?: { text: string; at: string; by: string };
      modules?: unknown[];
    };
    const figs = await this.figures.forRecord("course", node.id, "Course completion");
    const figure = figs[figs.length - 1];
    const stale = staleMap.get(node.id);
    return {
      id: node.id,
      title: data.title ?? node.id,
      stage: data.stage ?? "",
      owner: data.owner,
      stageOwners: data.stageOwners,
      progressNote: data.progressNote,
      completion: figure
        ? {
            value: Number(figure.value),
            unit: figure.unit,
            explainer: figure.explainer,
          }
        : null,
      stale: Boolean(stale),
      daysWaiting: stale?.daysWaiting,
    };
  }
}

function parseSlides(raw: string): Array<{ title: string; bullets: string[] }> | undefined {
  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end < 0) return undefined;
    const arr = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return undefined;
    return arr
      .map((s) => {
        const o = s as { title?: unknown; bullets?: unknown };
        return {
          title: typeof o.title === "string" ? o.title : String(o.title ?? "Slide"),
          bullets: Array.isArray(o.bullets)
            ? o.bullets.map((b) => String(b))
            : [],
        };
      })
      .slice(0, 12);
  } catch {
    return undefined;
  }
}

function heuristicOutline(
  topic: string,
  modules: Array<{ name: string }>,
): Array<{ title: string; bullets: string[] }> {
  const slides: Array<{ title: string; bullets: string[] }> = [
    { title: topic, bullets: ["Overview", "What you'll learn"] },
    { title: "Introduction", bullets: ["Why this matters", "Who this is for"] },
  ];
  for (const m of modules) {
    slides.push({ title: m.name, bullets: ["Key concepts", "Hands-on exercise"] });
  }
  slides.push({ title: "Wrap-up", bullets: ["Summary", "Next steps"] });
  return slides;
}
