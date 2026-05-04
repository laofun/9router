import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestDetailState = {
  existing: null,
  saved: [],
};

vi.mock("@/lib/usageDb", () => ({
  getRequestDetailById: vi.fn(async (id) => {
    if (requestDetailState.existing?.id === id) return requestDetailState.existing;
    return null;
  }),
  saveRequestDetail: vi.fn(async (detail) => {
    requestDetailState.saved.push(detail);
  }),
}));

describe("internal request-detail route", () => {
  beforeEach(() => {
    vi.resetModules();
    requestDetailState.existing = null;
    requestDetailState.saved = [];
  });

  afterEach(() => {
    requestDetailState.existing = null;
    requestDetailState.saved = [];
  });

  it("rejects unknown top-level fields instead of merging arbitrary payloads", async () => {
    const { POST } = await import("../../src/app/api/internal/request-detail/route.js");

    const response = await POST(new Request("http://localhost/api/internal/request-detail", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-source": "local",
      },
      body: JSON.stringify({
        id: "detail-1",
        provider: "anthropic",
        transcript: [{ role: "user", content: "wrong" }],
        request: { headers: { authorization: "Bearer secret" } },
      }),
    }));

    expect(response.status).toBe(400);
    expect(requestDetailState.saved).toEqual([]);
  });

  it("merges only allowed slots for incremental updates", async () => {
    requestDetailState.existing = {
      id: "detail-2",
      provider: "anthropic",
      model: "claude-3-5-haiku",
      request: { body: { messages: [{ role: "user", content: "hi" }] } },
      providerRequest: { model: "claude-3-5-haiku" },
      providerResponse: { id: "resp_1" },
      response: { content: "partial" },
      tokens: { prompt_tokens: 10 },
      latency: { ttft: 100 },
    };

    const { POST } = await import("../../src/app/api/internal/request-detail/route.js");

    const response = await POST(new Request("http://localhost/api/internal/request-detail", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-source": "local",
      },
      body: JSON.stringify({
        id: "detail-2",
        tokens: { completion_tokens: 20 },
        latency: { total: 500 },
        response: { content: "final" },
        providerResponse: { ok: true, status: 200 },
      }),
    }));

    expect(response.status).toBe(200);
    expect(requestDetailState.saved).toHaveLength(1);
    expect(requestDetailState.saved[0].tokens).toEqual({ prompt_tokens: 10, completion_tokens: 20 });
    expect(requestDetailState.saved[0].latency).toEqual({ ttft: 100, total: 500 });
    expect(requestDetailState.saved[0].response).toEqual({ content: "final" });
    expect(requestDetailState.saved[0].providerResponse).toEqual({ ok: true, status: 200 });
  });
});
