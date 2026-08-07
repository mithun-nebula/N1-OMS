export interface LlmProvider {
  complete(prompt: string, opts?: { system?: string }): Promise<string>;
}

export interface VideoMeeting {
  id: string;
  link: string;
  kind: "online" | "in-person" | "both";
}

export interface VideoProvider {
  createMeeting(input: { title: string }): Promise<VideoMeeting>;
  cancelMeeting(id: string): Promise<void>;
}

export interface FrappeRecord {
  doctype: string;
  name: string;
  data: Record<string, unknown>;
}

export interface FrappeProvider {
  get(doctype: string, name: string): Promise<FrappeRecord | undefined>;
  list(doctype: string, filters?: Record<string, unknown>): Promise<FrappeRecord[]>;
  create(doctype: string, data: Record<string, unknown>): Promise<FrappeRecord>;
  update(doctype: string, name: string, data: Record<string, unknown>): Promise<FrappeRecord>;
}

class StubLlmProvider implements LlmProvider {
  async complete(_prompt: string): Promise<string> {
    throw new Error("LLM provider not configured (decision still open).");
  }
}

class StubVideoProvider implements VideoProvider {
  async createMeeting(input: { title: string }): Promise<VideoMeeting> {
    return {
      id: `meet_${Date.now().toString(36)}`,
      link: `https://meet.example/${encodeURIComponent(input.title)}`,
      kind: "online",
    };
  }
  async cancelMeeting(_id: string): Promise<void> {}
}

class StubFrappeProvider implements FrappeProvider {
  async get(): Promise<FrappeRecord | undefined> {
    throw new Error("Frappe provider not configured (Phase 2).");
  }
  async list(): Promise<FrappeRecord[]> {
    return [];
  }
  async create(): Promise<FrappeRecord> {
    throw new Error("Frappe provider not configured (Phase 2).");
  }
  async update(): Promise<FrappeRecord> {
    throw new Error("Frappe provider not configured (Phase 2).");
  }
}

export const providers = {
  llm: new StubLlmProvider(),
  video: new StubVideoProvider(),
  frappe: new StubFrappeProvider(),
};
