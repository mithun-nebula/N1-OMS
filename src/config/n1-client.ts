import type { N1Provider, N1Record } from "./providers";

export interface N1ClientConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  maxRetries?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

const RESOURCE_PREFIX = "/api/resource";

export class N1HttpClient implements N1Provider {
  readonly id = "n1-http";
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(private readonly config: N1ClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 200;
  }

  async get(doctype: string, name: string): Promise<N1Record | undefined> {
    const data = await this.request<{ data: unknown }>(
      "GET",
      `${RESOURCE_PREFIX}/${doctype}/${encodeURIComponent(name)}`,
    );
    return toRecord(doctype, name, data.data);
  }

  async list(
    doctype: string,
    filters?: Record<string, unknown>,
  ): Promise<N1Record[]> {
    const query = filters ? `?filters=${encodeURIComponent(JSON.stringify(filters))}` : "";
    const data = await this.request<{ data: unknown[] }>(
      "GET",
      `${RESOURCE_PREFIX}/${doctype}${query}`,
    );
    return (data.data ?? []).map((row) =>
      toRecord(doctype, String((row as { name?: unknown }).name ?? ""), row),
    );
  }

  async create(
    doctype: string,
    data: Record<string, unknown>,
  ): Promise<N1Record> {
    const result = await this.request<{ data: { name: string; [k: string]: unknown } }>(
      "POST",
      `${RESOURCE_PREFIX}/${doctype}`,
      data,
    );
    return toRecord(doctype, result.data.name, result.data);
  }

  async update(
    doctype: string,
    name: string,
    data: Record<string, unknown>,
  ): Promise<N1Record> {
    const result = await this.request<{ data: { name: string; [k: string]: unknown } }>(
      "PUT",
      `${RESOURCE_PREFIX}/${doctype}/${encodeURIComponent(name)}`,
      data,
    );
    return toRecord(doctype, result.data.name, result.data);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `token ${this.config.apiKey}:${this.config.apiSecret}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (res.status === 404) {
          throw new N1NotFoundError(path);
        }
        if (!res.ok) {
          throw new N1HttpError(method, path, res.status, await safeText(res));
        }
        return (await res.json()) as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof N1NotFoundError) throw err;
        if (err instanceof N1HttpError && err.status >= 400 && err.status < 500) {
          throw err;
        }
        if (attempt < this.maxRetries) {
          await delay(this.retryDelayMs * (attempt + 1));
        }
      }
    }
    throw lastError ?? new Error(`N1 request failed: ${method} ${path}`);
  }
}

export class N1HttpError extends Error {
  constructor(
    method: string,
    path: string,
    public readonly status: number,
    body: string,
  ) {
    super(`N1 ${method} ${path} → ${status}: ${body.slice(0, 200)}`);
    this.name = "N1HttpError";
  }
}

export class N1NotFoundError extends Error {
  constructor(path: string) {
    super(`N1 record not found: ${path}`);
    this.name = "N1NotFoundError";
  }
}

function toRecord(
  doctype: string,
  name: string,
  data: unknown,
): N1Record {
  return { doctype, name, data: (data ?? {}) as Record<string, unknown> };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
