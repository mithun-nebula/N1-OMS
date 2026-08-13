export type ProviderMode = "stub" | "live";

export interface Env {
  nodeEnv: string;
  authSecret: string;
  databaseUrl: string | undefined;
  n1BaseUrl: string | undefined;
  n1ApiKey: string | undefined;
  n1ApiSecret: string | undefined;
  llmProvider: string;
  videoProvider: string;
  isProduction: boolean;
  isTest: boolean;
  seedDemo: boolean;
  bootstrapUser: string | undefined;
  bootstrapPassword: string | undefined;
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function buildEnv(): Env {
  const nodeEnv = read("NODE_ENV") ?? "development";
  const authSecret =
    read("ORG_AUTH_SECRET") ?? "dev-insecure-secret-change-me-in-prod";
  const isProduction = nodeEnv === "production";
  const isTest = nodeEnv === "test" || read("VITEST") !== undefined;
  return {
    nodeEnv,
    authSecret,
    databaseUrl: read("DATABASE_URL"),
    n1BaseUrl: read("N1_BASE_URL"),
    n1ApiKey: read("N1_API_KEY"),
    n1ApiSecret: read("N1_API_SECRET"),
    llmProvider: read("ORG_LLM_PROVIDER") ?? "stub",
    videoProvider: read("ORG_VIDEO_PROVIDER") ?? "stub",
    isProduction,
    isTest,
    seedDemo: resolveSeedDemo({
      isProduction,
      isTest,
      explicit: read("ORG_SEED_DEMO"),
    }),
    bootstrapUser: read("ORG_BOOTSTRAP_USER"),
    bootstrapPassword: read("ORG_BOOTSTRAP_PASSWORD"),
  };
}

/**
 * Whether to seed the nine demo people, their logins and the sample records.
 *
 * Defaults to ON, because every one of the 12 test files builds its world with
 * `buildDemoWorld()` and asserts against that seed — switching it off under test
 * would take the whole suite down.
 *
 * Order matters: tests win over everything, then an explicit setting, then
 * production defaults to off so a real database is never populated with fake
 * staff and known passwords.
 */
export function resolveSeedDemo(ctx: {
  isProduction: boolean;
  isTest: boolean;
  explicit?: string;
}): boolean {
  if (ctx.isTest) return true;
  if (ctx.explicit !== undefined) return ctx.explicit.toLowerCase() !== "false";
  return !ctx.isProduction;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= buildEnv();
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

export function n1Mode(): ProviderMode {
  const e = env();
  return e.n1BaseUrl && e.n1ApiKey && e.n1ApiSecret ? "live" : "stub";
}

export function llmMode(): ProviderMode {
  return env().llmProvider === "stub" ? "stub" : "live";
}

export function videoMode(): ProviderMode {
  return env().videoProvider === "stub" ? "stub" : "live";
}
