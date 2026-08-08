import type { NodeId } from "@/spine/operation/types";
import type { Figure, FigureStore } from "@/spine/figures/types";

export interface CourseModule {
  name: string;
  state: string;
}

export function courseCompletionFigure(
  store: FigureStore,
  course: { id: NodeId; title: string; modules: CourseModule[] },
): Figure {
  const total = course.modules.length;
  const done = course.modules.filter((m) => m.state === "published").length;
  const inReview = course.modules.filter((m) => m.state === "review").length;
  const notStarted = course.modules.filter(
    (m) => m.state === "not-started",
  ).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return {
    id: store.nextId(),
    label: "Course completion",
    value: pct,
    unit: "%",
    computedFrom: [
      { label: "Modules finished", value: done },
      { label: "Modules in review", value: inReview },
      { label: "Modules not started", value: notStarted },
      { label: "Total modules", value: total },
    ],
    explainer: `${done} of ${total} modules finished, ${inReview} in review, ${notStarted} not started.`,
    computedAt: new Date().toISOString(),
    sourceNodeType: "course",
    sourceNodeId: course.id,
  };
}

export function recomputeCompletion(
  store: FigureStore,
  course: { id: NodeId; title: string; modules: CourseModule[] },
): Figure {
  const figure = courseCompletionFigure(store, course);
  store.replace(figure);
  return figure;
}
