export type ProviderMode = "stub" | "live";

export interface Env {
  nodeEnv: string;
  authSecret: string;
  n1BaseUrl: string | undefined;
  n1ApiKey: string | undefined;
  n1ApiSecret: string | undefined;
  llmProvider: string;
  videoProvider: string;
  isProduction: boolean;
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function buildEnv(): Env {
  const nodeEnv = read("NODE_ENV") ?? "development";
  const authSecret =
    read("ORG_AUTH_SECRET") ?? "dev-insecure-secret-change-me-in-prod";
  return {
    nodeEnv,
    authSecret,
    n1BaseUrl: read("N1_BASE_URL"),
    n1ApiKey: read("N1_API_KEY"),
    n1ApiSecret: read("N1_API_SECRET"),
    llmProvider: read("ORG_LLM_PROVIDER") ?? "stub",
    videoProvider: read("ORG_VIDEO_PROVIDER") ?? "stub",
    isProduction: nodeEnv === "production",
  };
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
