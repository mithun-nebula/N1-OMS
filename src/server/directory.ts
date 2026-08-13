import { PeopleDirectory } from "@/domains/shared/directory";

/**
 * Process-wide people directory.
 *
 * On `globalThis` for the same reason as `limiter.ts`: Next.js dev reloads
 * modules, and a plain module-level singleton would be rebuilt empty while the
 * gate still held a reference to the old one.
 */
const globalForDirectory = globalThis as unknown as {
  __orgPeopleDirectory?: PeopleDirectory;
};

export function directory(): PeopleDirectory {
  if (!globalForDirectory.__orgPeopleDirectory) {
    globalForDirectory.__orgPeopleDirectory = new PeopleDirectory();
  }
  return globalForDirectory.__orgPeopleDirectory;
}

export type { PeopleDirectory };
