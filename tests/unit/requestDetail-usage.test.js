import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";

async function flushWriteQueue() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function readPersistedRequestDetails(tempDir) {
  const filePath = path.join(tempDir, "request-details.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function createCorruptedRequestDetailsFile(tempDir, content) {
  fs.writeFileSync(path.join(tempDir, "request-details.json"), content, "utf8");
}

function createObservabilitySettings() {
  return {
    enableObservability: true,
    observabilityBatchSize: 1,
    observabilityFlushIntervalMs: 60000,
    observabilityMaxJsonSize: 5,
  };
}

function mockObservabilitySettings() {
  vi.doMock("@/lib/localDb", () => ({
    getSettings: vi.fn(async () => createObservabilitySettings()),
  }));
}

async function importFreshRequestDetailsDb() {
  vi.resetModules();
  mockSettingsModule();
  return import("@/lib/requestDetailsDb.js");
}

function createTranscriptLikePayload() {
  return {
    messages: [{ role: "user", content: "should not persist" }],
    output: [{ type: "message", text: "wrong slot" }],
    choices: [{ delta: { content: "bad" } }],
  };
}

function createResponseLikePayload() {
  return {
    ok: true,
    url: "http://localhost:20128/v1/chat/completions",
    status: 200,
    statusText: "OK",
    bodyUsed: false,
    headers: { authorization: "Bearer secret" },
  };
}

function createValidDetail(id = "detail-test") {
  return {
    id,
    provider: "anthropic",
    model: "claude-3-5-haiku",
    connectionId: "conn-1",
    timestamp: "2026-05-03T10:00:00.000Z",
    status: "200 OK",
    latency: { totalMs: 1234 },
    tokens: { prompt_tokens: 10, completion_tokens: 20 },
    request: { headers: { authorization: "Bearer secret", accept: "application/json" }, body: { messages: [{ role: "user", content: "hi" }] } },
    providerRequest: { model: "claude-3-5-haiku", messages: [{ role: "user", content: "hi" }] },
    providerResponse: { id: "resp_1" },
    response: { content: "hello" },
  };
}

function hasOnlyAllowedTopLevelKeys(record) {
  return Object.keys(record).sort().join(",") === [
    "connectionId",
    "id",
    "latency",
    "model",
    "provider",
    "providerRequest",
    "providerResponse",
    "request",
    "response",
    "status",
    "timestamp",
    "tokens",
  ].join(",");
}

function isTruncatedObject(value) {
  return value && typeof value === "object" && value._truncated === true;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function expectNoTranscriptShape(value) {
  expect(value?.messages).toBeUndefined();
  expect(value?.output).toBeUndefined();
  expect(value?.choices).toBeUndefined();
}

function expectNoResponseLikeShape(value) {
  expect(value?.ok).toBeUndefined();
  expect(value?.url).toBeUndefined();
  expect(value?.status).toBeUndefined();
  expect(value?.statusText).toBeUndefined();
  expect(value?.bodyUsed).toBeUndefined();
}

function mockSettingsModule() {
  mockObservabilitySettings();
}

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
    const requestDetailsDb = await importFreshRequestDetailsDb();

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
    await flushWriteQueue();

    const details = await requestDetailsDb.getRequestDetails({ pageSize: 10 });
    const saved = details.details.find((detail) => detail.id === "detail-large");

    expect(saved).toBeDefined();
    expect(JSON.stringify(saved).length).toBeLessThan(20000);
  });

  it("returns lightweight recent request detail summaries without raw payload blobs", async () => {
    process.env.OBSERVABILITY_BATCH_SIZE = "1";
    const requestDetailsDb = await importFreshRequestDetailsDb();

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
    await flushWriteQueue();

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

  it("drops unknown top-level fields and sanitizes response-like payloads before persistence", async () => {
    process.env.OBSERVABILITY_BATCH_SIZE = "1";
    const requestDetailsDb = await importFreshRequestDetailsDb();

    await requestDetailsDb.saveRequestDetail({
      ...createValidDetail("detail-sanitized"),
      unexpected: "should be dropped",
      providerResponse: createResponseLikePayload(),
      response: {
        ...createTranscriptLikePayload(),
        content: "hello",
      },
    });
    await flushWriteQueue();

    const persisted = readPersistedRequestDetails(tempDir);
    const record = persisted.records.find((item) => item.id === "detail-sanitized");

    expect(record).toBeDefined();
    expect(hasOnlyAllowedTopLevelKeys(record)).toBe(true);
    expect(record.unexpected).toBeUndefined();
    expectNoResponseLikeShape(record.providerResponse);
    expectNoTranscriptShape(record.response);
    expect(record.request.headers.authorization).toBeUndefined();
    expect(record.request.headers.accept).toBe("application/json");
  });

  it("repairs a corrupted request-details file on load", async () => {
    createCorruptedRequestDetailsFile(tempDir, '{"records":[{"id":"bad","providerResponse":{"ok":true,"status":200},"response":{"messages":[{"role":"user","content":"oops"}]}}],"junk":true}');
    mockSettingsModule();

    const requestDetailsDb = await importFreshRequestDetailsDb();
    const details = await requestDetailsDb.getRequestDetails({ pageSize: 10 });
    const repaired = details.details.find((item) => item.id === "bad");

    expect(repaired).toBeDefined();
    expectNoResponseLikeShape(repaired.providerResponse);
    expectNoTranscriptShape(repaired.response);

    const persisted = readPersistedRequestDetails(tempDir);
    expect(Array.isArray(persisted.records)).toBe(true);
    expect(persisted.junk).toBeUndefined();
  });

  it("truncates oversized nested payloads after sanitization", async () => {
    process.env.OBSERVABILITY_BATCH_SIZE = "1";
    const requestDetailsDb = await importFreshRequestDetailsDb();

    await requestDetailsDb.saveRequestDetail({
      ...createValidDetail("detail-truncate"),
      providerRequest: {
        huge: "y".repeat(200000),
        nested: createTranscriptLikePayload(),
      },
    });
    await flushWriteQueue();

    const persisted = readPersistedRequestDetails(tempDir);
    const record = persisted.records.find((item) => item.id === "detail-truncate");

    expect(record).toBeDefined();
    expect(isTruncatedObject(record.providerRequest)).toBe(true);
  });
});
