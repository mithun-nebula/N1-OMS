import { describe, it, expect } from "vitest";
import { N1HttpClient, N1NotFoundError } from "./n1-client";
import type { N1Record } from "./providers";

function makeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const impl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { impl, calls };
}

describe("N1HttpClient — service-account auth", () => {
  it("sends the token KEY:SECRET authorization header", async () => {
    const { impl, calls } = makeFetch([
      { status: 200, body: { data: { name: "E1", employee_name: "Priya" } } },
    ]);
    const client = new N1HttpClient({
      baseUrl: "https://n1.example",
      apiKey: "KEY",
      apiSecret: "SECRET",
      fetchImpl: impl,
    });
    const rec = await client.get("Employee", "E1");
    expect((rec as N1Record).data.employee_name).toBe("Priya");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "token KEY:SECRET",
      "Content-Type": "application/json",
    });
    expect(calls[0].url).toBe("https://n1.example/api/resource/Employee/E1");
  });
});

describe("N1HttpClient — retry", () => {
  it("retries on 5xx then succeeds", async () => {
    const { impl, calls } = makeFetch([
      { status: 503, body: { error: "down" } },
      { status: 503, body: { error: "down" } },
      { status: 200, body: { data: [{ name: "E1" }] } },
    ]);
    const client = new N1HttpClient({
      baseUrl: "https://n1.example",
      apiKey: "K",
      apiSecret: "S",
      fetchImpl: impl,
      maxRetries: 3,
      retryDelayMs: 1,
    });
    const rows = await client.list("Employee");
    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it("does not retry on 404 (not found)", async () => {
    const { impl, calls } = makeFetch([{ status: 404, body: {} }]);
    const client = new N1HttpClient({
      baseUrl: "https://n1.example",
      apiKey: "K",
      apiSecret: "S",
      fetchImpl: impl,
      maxRetries: 3,
      retryDelayMs: 1,
    });
    await expect(client.get("Employee", "missing")).rejects.toBeInstanceOf(
      N1NotFoundError,
    );
    expect(calls).toHaveLength(1);
  });

  it("does not retry on 4xx client errors", async () => {
    const { impl, calls } = makeFetch([{ status: 403, body: { exc: "forbidden" } }]);
    const client = new N1HttpClient({
      baseUrl: "https://n1.example",
      apiKey: "K",
      apiSecret: "S",
      fetchImpl: impl,
      maxRetries: 3,
      retryDelayMs: 1,
    });
    await expect(client.get("Employee", "E1")).rejects.toThrow(/403/);
    expect(calls).toHaveLength(1);
  });
});
