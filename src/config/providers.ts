import { env, n1Mode } from "./env";
import { N1HttpClient } from "./n1-client";

export interface LlmProvider {
  complete(prompt: string, opts?: { system?: string }): Promise<string>;
  readonly id: string;
}

export interface VideoMeeting {
  id: string;
  link: string;
  kind: "online" | "in-person" | "both";
}

export interface VideoProvider {
  createMeeting(input: { title: string }): Promise<VideoMeeting>;
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

class UnconfiguredLlmProvider implements LlmProvider {
  readonly id = "stub";
  async complete(_prompt: string): Promise<string> {
    throw new Error(
      "LLM provider not configured (set ORG_LLM_PROVIDER=dev for canned responses, or implement a real LlmProvider).",
    );
  }
}

class DevLlmProvider implements LlmProvider {
  readonly id = "dev";
  async complete(prompt: string): Promise<string> {
    return `[dev-llm] No real provider wired. Echo: ${prompt.slice(0, 120)}`;
  }
}

class StubVideoProvider implements VideoProvider {
  readonly id = "stub";
  async createMeeting(input: { title: string }): Promise<VideoMeeting> {
    return {
      id: `meet_${Date.now().toString(36)}`,
      link: `https://meet.example/${encodeURIComponent(input.title)}`,
      kind: "online",
    };
  }
  async cancelMeeting(_id: string): Promise<void> {}
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
    case "stub":
    default:
      return new UnconfiguredLlmProvider();
  }
}

function createVideo(): VideoProvider {
  switch (env().videoProvider) {
    case "stub":
    default:
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
