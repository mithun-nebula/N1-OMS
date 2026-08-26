import type { LanguageModel } from "ai";
import { env, n1Mode } from "./env";
import { N1HttpClient } from "./n1-client";
import { createFakeLanguageModel } from "./llm-fake";
import { StubVideoProvider } from "./video-stub";
import { GoogleMeetVideoProvider } from "./video-google";

/**
 * The model seam.
 *
 * `complete` is the plain text call `course/service.ts:generateDeck` has always
 * used and still does. `languageModel` is what the agent drives — the same
 * provider choice, expressed as something the AI SDK can put in a tool loop.
 *
 * Both are on one interface on purpose: there is exactly one place in this
 * codebase that decides which model is in play, and adding a second would mean
 * the deck generator and the assistant could silently disagree about it.
 */
export interface LlmProvider {
  complete(prompt: string, opts?: { system?: string }): Promise<string>;
  /**
   * The model the agent runs on. Throws where there is none — callers are
   * expected to catch and fall back, the way `generateDeck` already does.
   *
   * **Never a bare string.** A plain provider-slug string typechecks and routes
   * through the Vercel AI Gateway instead of this project's service account.
   * See CLAUDE.md — and note the grep in the phase checklist looks for exactly
   * that literal, so it is spelled out there and deliberately not here.
   */
  languageModel(): LanguageModel;
  readonly id: string;
}

export interface VideoMeeting {
  id: string;
  link: string;
  kind: "online" | "in-person" | "both";
}

export interface VideoProvider {
  /**
   * `from`, `to` and `externals` are optional because the stub ignores all
   * three. A real provider needs them: the times become the calendar event, and
   * the externals become its attendees, which is what makes **Google** send the
   * invitation email rather than this codebase needing a mail transport.
   */
  createMeeting(input: {
    title: string;
    from?: string;
    to?: string;
    externals?: Array<{ email: string }>;
  }): Promise<VideoMeeting>;
  /** Takes the **provider's own** id — `VideoMeeting.id`, never a local one. */
  cancelMeeting(id: string): Promise<void>;
  readonly id: string;
}

export interface N1Record {
  doctype: string;
  name: string;
  data: Record<string, unknown>;
}

export interface N1Provider {
  get(doctype: string, name: string): Promise<N1Record | undefined>;
  list(doctype: string, filters?: Record<string, unknown>): Promise<N1Record[]>;
  create(doctype: string, data: Record<string, unknown>): Promise<N1Record>;
  update(doctype: string, name: string, data: Record<string, unknown>): Promise<N1Record>;
  readonly id: string;
}

/** What `.env.example` ships with. Treated as "unset", not as a project. */
const PLACEHOLDER_PROJECT = "your-gcp-project-id";

const NOT_CONFIGURED =
  "LLM provider not configured (ORG_LLM_PROVIDER: dev for canned text, " +
  "fake for scripted tool calls in tests, vertex for the real model).";

/**
 * The default, and deliberately useless.
 *
 * Every test builds its world without setting `ORG_LLM_PROVIDER`, so this is
 * what they get — which is the point: **no test can reach the network by
 * forgetting something.** Reaching the model has to be asked for.
 */
class UnconfiguredLlmProvider implements LlmProvider {
  readonly id = "stub";
  async complete(_prompt: string): Promise<string> {
    throw new Error(NOT_CONFIGURED);
  }
  languageModel(): LanguageModel {
    throw new Error(NOT_CONFIGURED);
  }
}

class DevLlmProvider implements LlmProvider {
  readonly id = "dev";
  async complete(prompt: string): Promise<string> {
    return `[dev-llm] No real provider wired. Echo: ${prompt.slice(0, 120)}`;
  }
  languageModel(): LanguageModel {
    // An echo cannot drive a tool loop. `fake` is the one that can.
    throw new Error("The dev provider echoes text and cannot run tools — use ORG_LLM_PROVIDER=fake.");
  }
}

/**
 * Scripted tool calls, for tests. No network, no cost, no credentials.
 * See `llm-fake.ts` — a test queues the steps and asserts what was called.
 */
class FakeLlmProvider implements LlmProvider {
  readonly id = "fake";
  async complete(prompt: string): Promise<string> {
    return `[fake-llm] ${prompt.slice(0, 80)}`;
  }
  languageModel(): LanguageModel {
    return createFakeLanguageModel();
  }
}

/**
 * Vertex AI, authenticated by the service account named in
 * `GOOGLE_APPLICATION_CREDENTIALS`.
 *
 * `@ai-sdk/google-vertex`, **not** `@ai-sdk/google` — the latter is the AI
 * Studio API-key provider and cannot use a service account.
 *
 * The import is dynamic so that merely loading this module does not pull in
 * `google-auth-library`; nothing but a real Vertex run should pay for it, and
 * the test suite never takes this branch.
 */
class VertexLlmProvider implements LlmProvider {
  readonly id = "vertex";

  /**
   * The project id, from the environment or from the key itself.
   *
   * `.env` ships with `GOOGLE_VERTEX_PROJECT=your-gcp-project-id`, and a
   * placeholder that *looks* set is worse than one that is missing: it silently
   * addresses a project nobody owns and comes back as a 403 that reads like a
   * permissions bug. A service-account key already names its project, so the
   * placeholder is treated as absent and the key is believed instead.
   */
  private projectId(): string {
    const configured = env().vertexProject;
    if (configured && configured !== PLACEHOLDER_PROJECT) return configured;

    // Passing `undefined` is NOT enough: the SDK reads GOOGLE_VERTEX_PROJECT
    // out of the environment itself, so the placeholder wins anyway and comes
    // back as `Permission denied on resource project your-gcp-project-id` —
    // a 403 that reads like a broken service account rather than an unedited
    // `.env`. The key already names its project, so read it and be explicit.
    const keyPath = env().vertexCredentials;
    if (keyPath) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readFileSync } = require("node:fs") as typeof import("node:fs");
        const parsed = JSON.parse(readFileSync(keyPath, "utf8")) as { project_id?: string };
        if (parsed.project_id) return parsed.project_id;
      } catch {
        // Fall through to the error below, which says something useful.
      }
    }
    throw new Error(
      "No Vertex project: set GOOGLE_VERTEX_PROJECT to the real project id, " +
        "or point GOOGLE_APPLICATION_CREDENTIALS at a service-account key that names one.",
    );
  }

  private provider() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createVertex } = require("@ai-sdk/google-vertex") as typeof import("@ai-sdk/google-vertex");
    return createVertex({
      project: this.projectId(),
      location: env().vertexLocation,
    });
  }

  languageModel(): LanguageModel {
    // A model object, never a bare string. See CLAUDE.md.
    return this.provider()(env().vertexModel);
  }

  async complete(prompt: string, opts?: { system?: string }): Promise<string> {
    const { generateText } = await import("ai");
    const result = await generateText({
      model: this.languageModel(),
      system: opts?.system,
      prompt,
    });
    return result.text;
  }
}

class StubN1Provider implements N1Provider {
  readonly id = "stub";
  async get(): Promise<N1Record | undefined> {
    throw new Error("N1 not configured (set N1_BASE_URL/KEY/SECRET).");
  }
  async list(): Promise<N1Record[]> {
    return [];
  }
  async create(): Promise<N1Record> {
    throw new Error("N1 not configured (set N1_BASE_URL/KEY/SECRET).");
  }
  async update(): Promise<N1Record> {
    throw new Error("N1 not configured (set N1_BASE_URL/KEY/SECRET).");
  }
}

function createLlm(): LlmProvider {
  switch (env().llmProvider) {
    case "dev":
      return new DevLlmProvider();
    case "fake":
      return new FakeLlmProvider();
    case "vertex":
      return new VertexLlmProvider();
    case "stub":
    default:
      return new UnconfiguredLlmProvider();
  }
}

function createVideo(): VideoProvider {
  switch (env().videoProvider) {
    case "google":
      return new GoogleMeetVideoProvider();
    case "stub":
    default:
      // The default, and inert. Every test builds its world without setting
      // ORG_VIDEO_PROVIDER, so this is what they get — which is the point: no
      // test can reach Google by forgetting something.
      return new StubVideoProvider();
  }
}

function createN1(): N1Provider {
  const e = env();
  if (n1Mode() === "live") {
    return new N1HttpClient({
      baseUrl: e.n1BaseUrl as string,
      apiKey: e.n1ApiKey as string,
      apiSecret: e.n1ApiSecret as string,
    });
  }
  return new StubN1Provider();
}

export interface Providers {
  llm: LlmProvider;
  video: VideoProvider;
  n1: N1Provider;
}

let cached: Providers | undefined;

export function providers(): Providers {
  cached ??= {
    llm: createLlm(),
    video: createVideo(),
    n1: createN1(),
  };
  return cached;
}

export function resetProviders(): void {
  cached = undefined;
}

export interface ProviderModes {
  llm: { id: string; mode: "stub" | "live" };
  video: { id: string; mode: "stub" | "live" };
  n1: { id: string; mode: "stub" | "live" };
}

export function providerModes(): ProviderModes {
  const p = providers();
  const mode = (id: string) => (id === "stub" ? ("stub" as const) : ("live" as const));
  return {
    llm: { id: p.llm.id, mode: mode(p.llm.id) },
    video: { id: p.video.id, mode: mode(p.video.id) },
    n1: { id: p.n1.id, mode: mode(p.n1.id) },
  };
}
