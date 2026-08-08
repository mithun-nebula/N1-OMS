import { providers } from "@/config/providers";
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

export function getPeopleService(): PeopleRecordService {
  peopleService ??= new PeopleRecordService(getWorld().deps.graph, providers().n1);
  return peopleService;
}
