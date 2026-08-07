import type { DomainModule } from "./types";
import { peopleDomain } from "./people";
import { courseDomain } from "./course";
import { workplaceDomain } from "./workplace";
import { assistantDomain } from "./assistant";
import { autonomyDomain } from "./autonomy";

export type { DomainContext, DomainModule } from "./types";
export { DEMO_PEOPLE, DEMO_TEAM_LEADS } from "./shared/people-roster";

export const DOMAINS: DomainModule[] = [
  peopleDomain,
  courseDomain,
  workplaceDomain,
  assistantDomain,
  autonomyDomain,
];
