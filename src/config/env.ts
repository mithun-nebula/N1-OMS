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
  /**
   * Vertex AI. The *path* to the service-account key, never the key itself —
   * `.gitignore` covers `.env*` but not `*.json`, so the file lives outside the
   * repository and only its location is ever configured here.
   */
  vertexCredentials: string | undefined;
  vertexProject: string | undefined;
  vertexLocation: string;
  vertexModel: string;
  /**
   * The live (bidirectional audio) model, and **its own region.**
   *
   * ⚠ **Two values, not one, and that is deliberate.** `vertexLocation` is
   * `global` because Gemini 3.x is global-endpoint only, and chat depends on
   * that. The live socket was proved against `us-central1`, and the live model
   * 404s in several regions where chat is perfectly happy. Sharing one location
   * would have meant moving chat to make voice work.
   *
   * The model id is **not** defaulted to a guess: it was asked of Vertex (see
   * `phases/phase 6/outcome.md` §1) and only one publisher model on this
   * project supports bidirectional streaming.
   */
  vertexLiveModel: string;
  vertexLiveLocation: string;
  /**
   * Google Calendar OAuth — how a Meet link is actually created.
   *
   * **OAuth, one shared token, not a service account.** The consenting account
   * is personal Gmail; a service account would need domain-wide delegation,
   * which needs Workspace. `docs/STATUS.md` said otherwise for weeks and that
   * claim would have cost a day.
   *
   * Every meeting is therefore organised by the one consenting account as far
   * as Google is concerned. The application's own `organizer` field stays
   * truthful; only Google sees a single identity.
   */
  googleOauthClientId: string | undefined;
  googleOauthClientSecret: string | undefined;
  googleOauthRefreshToken: string | undefined;
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
    vertexCredentials: read("GOOGLE_APPLICATION_CREDENTIALS"),
    vertexProject: read("GOOGLE_VERTEX_PROJECT"),
    // Gemini 3.x may be global-endpoint only, so that is the default.
    vertexLocation: read("GOOGLE_VERTEX_LOCATION") ?? "global",
    // Never gemini-2.5-flash: it has an announced expiry and must not be built on.
    vertexModel: read("GOOGLE_VERTEX_MODEL") ?? "gemini-3.1-flash-lite",
    // Native-audio in and out. Note it refuses `responseModalities: ["TEXT"]`
    // outright — closes the socket with 1007 — so the transcript on screen
    // comes from the transcription config, not from a text modality.
    vertexLiveModel: read("GOOGLE_VERTEX_LIVE_MODEL") ?? "gemini-live-2.5-flash-native-audio",
    vertexLiveLocation: read("GOOGLE_VERTEX_LIVE_LOCATION") ?? "us-central1",
    googleOauthClientId: read("GOOGLE_OAUTH_CLIENT_ID"),
    googleOauthClientSecret: read("GOOGLE_OAUTH_CLIENT_SECRET"),
    googleOauthRefreshToken: read("GOOGLE_OAUTH_REFRESH_TOKEN"),
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

/*
 * ── `llmMode()` and `videoMode()` were here, and are deliberately gone ───────
 *
 * Both read the *environment variable* and returned "live" whenever it was not
 * the string "stub". Both had **zero callers** anywhere in `src/`: the thing
 * that actually answers "is video live?" is `providerModes()` in
 * `providers.ts`, which reads the constructed provider's own `id`.
 *
 * Two sources of truth for the same question is how `/admin` ends up lying,
 * and these two were the worse source. `ORG_VIDEO_PROVIDER=google` with a
 * missing refresh token makes `createVideo()` fall back to the stub — the
 * env-var reading would still have said "live" while the application was
 * demonstrably not. `providerModes()` cannot say that, because it is looking
 * at the object that will actually be called.
 *
 * `n1Mode()` above stays: it has real callers, and it reads credentials rather
 * than a mode string, so it cannot disagree with what gets constructed.
 */
