import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";

describe("extractUsageFromResponse", () => {
  let tempDir;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "n9router-request-details-"));
    process.env.DATA_DIR = tempDir;
    process.env.OBSERVABILITY_ENABLED = "true";
    process.env.OBSERVABILITY_BATCH_SIZE = "5000";
    process.env.OBSERVABILITY_FLUSH_INTERVAL_MS = "60000";
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.OBSERVABILITY_ENABLED;
    delete process.env.OBSERVABILITY_BATCH_SIZE;
    delete process.env.OBSERVABILITY_FLUSH_INTERVAL_MS;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("extracts cached tokens from OpenAI Responses usage", () => {
    const usage = extractUsageFromResponse({
      usage: {
        input_tokens: 1000,
        output_tokens: 50,
        input_tokens_details: { cached_tokens: 250 },
      },
    });

    expect(usage).toEqual({
      prompt_tokens: 1000,
      completion_tokens: 50,
      cache_read_input_tokens: 250,
      cache_creation_input_tokens: undefined,
    });
  });

  it("extracts cached tokens from Gemini usage metadata", () => {
    const usage = extractUsageFromResponse({
      usageMetadata: {
        promptTokenCount: 2000,
        candidatesTokenCount: 100,
        cachedContentTokenCount: 800,
        thoughtsTokenCount: 25,
      },
    });

    expect(usage).toEqual({
      prompt_tokens: 2000,
      completion_tokens: 100,
      cached_tokens: 800,
      reasoning_tokens: 25,
    });
  });

  it("stores compact request detail payloads instead of large duplicated blobs", async () => {
    process.env.OBSERVABILITY_BATCH_SIZE = "1";
    vi.doMock("@/lib/localDb", () => ({
      getSettings: vi.fn(async () => ({
        enableObservability: true,
        observabilityBatchSize: 1,
        observabilityFlushIntervalMs: 60000,
        observabilityMaxJsonSize: 5,
      })),
    }));
    const requestDetailsDb = await import("@/lib/requestDetailsDb.js");

    await requestDetailsDb.saveRequestDetail({
      id: "detail-large",
      provider: "anthropic",
      model: "claude-3-5-haiku",
      request: {
        body: {
          messages: [{ role: "user", content: "x".repeat(200000) }],
        },
      },
      providerRequest: { huge: "y".repeat(200000) },
      providerResponse: { huge: "z".repeat(200000) },
      response: { huge: "w".repeat(200000) },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const details = await requestDetailsDb.getRequestDetails({ pageSize: 10 });
    const saved = details.details.find((detail) => detail.id === "detail-large");

    expect(saved).toBeDefined();
    expect(JSON.stringify(saved).length).toBeLessThan(20000);
  });

  it("returns lightweight recent request detail summaries without raw payload blobs", async () => {
    process.env.OBSERVABILITY_BATCH_SIZE = "1";
    vi.doMock("@/lib/localDb", () => ({
      getSettings: vi.fn(async () => ({
        enableObservability: true,
        observabilityBatchSize: 1,
        observabilityFlushIntervalMs: 60000,
        observabilityMaxJsonSize: 5,
      })),
    }));
    const requestDetailsDb = await import("@/lib/requestDetailsDb.js");

    await requestDetailsDb.saveRequestDetail({
      id: "detail-summary",
      provider: "anthropic",
      model: "claude-3-5-haiku",
      connectionId: "conn-1",
      timestamp: "2026-05-03T10:00:00.000Z",
      status: "200 OK",
      latency: { totalMs: 1234 },
      tokens: { prompt_tokens: 10, completion_tokens: 20 },
      request: { huge: "x".repeat(10000) },
      providerRequest: { huge: "y".repeat(10000) },
      providerResponse: { huge: "z".repeat(10000) },
      response: { huge: "w".repeat(10000) },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const summaries = await requestDetailsDb.getRecentRequestDetailSummaries(5);

    expect(summaries).toEqual([
      {
        id: "detail-summary",
        provider: "anthropic",
        model: "claude-3-5-haiku",
        connectionId: "conn-1",
        timestamp: "2026-05-03T10:00:00.000Z",
        status: "200 OK",
        latency: { totalMs: 1234 },
        tokens: { prompt_tokens: 10, completion_tokens: 20 },
      },
    ]);
  });
});
