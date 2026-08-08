import type { DomainModule } from "./types";
import { peopleDomain } from "./people";
import { courseDomain } from "./course";
import { orgMemoryDomain } from "./org-memory";
import { workplaceDomain } from "./workplace";
import { assistantDomain } from "./assistant";
import { autonomyDomain } from "./autonomy";

export type { DomainContext, DomainModule } from "./types";
export { DEMO_PEOPLE, DEMO_TEAM_LEADS } from "./shared/people-roster";

export const DOMAINS: DomainModule[] = [
  peopleDomain,
  courseDomain,
  orgMemoryDomain,
  workplaceDomain,
  assistantDomain,
  autonomyDomain,
];
