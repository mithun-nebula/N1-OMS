import type { NodeId } from "@/spine/operation/types";
import type { RecordStore, RecordNode } from "@/spine/record/types";
import { STAGE_THRESHOLD_DAYS, type Stage } from "./stages";

export interface CourseVersion {
  courseId: NodeId;
  version: number;
  at: string;
  by: string;
  reason?: string;
  snapshot: Record<string, unknown>;
}

export function versionIdFor(courseId: string, version: number): NodeId {
  return `${courseId}#v${version}`;
}

export async function readVersions(
  graph: RecordStore,
  courseId: string,
): Promise<CourseVersion[]> {
  const versions = await graph.find(
    "course-version",
    (n) => (n.data as { courseId?: string }).courseId === courseId,
  );
  return versions
    .map((n) => n.data as unknown as CourseVersion)
    .sort((a, b) => a.version - b.version);
}

export async function snapshotCourse(
  graph: RecordStore,
  courseId: string,
  by: string,
  reason?: string,
): Promise<CourseVersion | undefined> {
  const node = await graph.getNode("course", courseId);
  if (!node) return undefined;
  const existing = await readVersions(graph, courseId);
  const version = existing.length === 0 ? 1 : existing[existing.length - 1].version + 1;
  const snapshot: CourseVersion = {
    courseId,
    version,
    at: new Date().toISOString(),
    by,
    reason,
    snapshot: { ...node.data },
  };
  await graph.putNode("course-version", versionIdFor(courseId, version), snapshot as unknown as Record<string, unknown>);
  return snapshot;
}

export async function getVersion(
  graph: RecordStore,
  courseId: string,
  version: number,
): Promise<CourseVersion | undefined> {
  const node = await graph.getNode("course-version", versionIdFor(courseId, version));
  return node ? (node.data as unknown as CourseVersion) : undefined;
}

export interface StaleCourse {
  courseId: NodeId;
  title: string;
  stage: string;
  owner?: string;
  daysWaiting: number;
}

export async function findStaleCourses(
  graph: RecordStore,
  asOf: string,
  thresholds: Partial<Record<Stage, number>> = STAGE_THRESHOLD_DAYS,
): Promise<StaleCourse[]> {
  const stale: StaleCourse[] = [];
  const asOfMs = new Date(asOf).getTime();
  const courses = (await graph.find("course", () => true)) as RecordNode[];
  for (const course of courses) {
    const data = course.data as {
      stage?: string;
      stageEnteredAt?: string;
      title?: string;
      owner?: string;
    };
    const stage = data.stage ?? "";
    const threshold =
      stage in thresholds
        ? (thresholds as Record<string, number>)[stage]
        : undefined;
    if (threshold === undefined || !data.stageEnteredAt) continue;
    const enteredMs = new Date(data.stageEnteredAt).getTime();
    const daysWaiting = Math.floor((asOfMs - enteredMs) / (1000 * 60 * 60 * 24));
    if (daysWaiting > threshold) {
      stale.push({
        courseId: course.id,
        title: data.title ?? course.id,
        stage,
        owner: data.owner,
        daysWaiting,
      });
    }
  }
  return stale.sort((a, b) => b.daysWaiting - a.daysWaiting);
}
