import { providers } from "@/config/providers";
import { CourseService } from "@/domains/course/service";
import { OrgMemoryService } from "@/domains/org-memory/service";
import { PeopleRecordService } from "@/domains/people/service";
import { buildDemoWorld, type DemoWorld } from "./bootstrap";

const globalForSpine = globalThis as unknown as {
  __orgSpineWorld?: DemoWorld;
};

export function getWorld(): DemoWorld {
  if (!globalForSpine.__orgSpineWorld) {
    globalForSpine.__orgSpineWorld = buildDemoWorld();
  }
  return globalForSpine.__orgSpineWorld;
}

export function getSpine() {
  return getWorld().spine;
}

let peopleService: PeopleRecordService | undefined;
let courseService: CourseService | undefined;
let orgMemoryService: OrgMemoryService | undefined;

export function getPeopleService(): PeopleRecordService {
  peopleService ??= new PeopleRecordService(getWorld().deps.graph, providers().n1);
  return peopleService;
}

export function getCourseService(): CourseService {
  courseService ??= new CourseService(getWorld().deps.graph, getWorld().deps.figures);
  return courseService;
}

export function getOrgMemoryService(): OrgMemoryService {
  orgMemoryService ??= new OrgMemoryService(getWorld().deps.graph);
  return orgMemoryService;
}
