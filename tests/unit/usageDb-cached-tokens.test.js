import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("@/lib/localDb.js", () => ({
  getApiKeys: vi.fn(async () => []),
  getProviderConnections: vi.fn(async () => []),
  getProviderNodes: vi.fn(async () => []),
  getPricingForModel: vi.fn(async () => null),
}));

describe("usageDb cached token stats", () => {
  let tempDir;

  beforeEach(() => {
    vi.resetModules();
    global._pendingRequests = { byModel: {}, byAccount: {} };
    global._pendingTimers = {};
    global._lastErrorProvider = { provider: "", ts: 0 };
    global._statsEmitter = undefined;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "n9router-usage-"));
    process.env.DATA_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("includes cached tokens in live and daily usage stats", async () => {
    const { saveRequestUsage, getUsageStats } = await import("@/lib/usageDb.js");

    await saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      tokens: { prompt_tokens: 1000, completion_tokens: 200, cache_read_input_tokens: 300 },
      timestamp: new Date().toISOString(),
      endpoint: "/v1/chat/completions",
    });
    await saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      tokens: { prompt_tokens: 500, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 125 } },
      timestamp: new Date().toISOString(),
      endpoint: "/v1/chat/completions",
    });

    const dailyStats = await getUsageStats("7d");
    expect(dailyStats.totalCachedTokens).toBe(425);
    expect(dailyStats.byProvider.openai.cachedTokens).toBe(425);
    expect(dailyStats.byModel["gpt-4 (openai)"].cachedTokens).toBe(425);

    const liveStats = await getUsageStats("24h");
    expect(liveStats.totalCachedTokens).toBe(425);
    expect(liveStats.byEndpoint["/v1/chat/completions|gpt-4|openai"].cachedTokens).toBe(425);
  });

  it("backfills cached tokens into existing daily summaries", async () => {
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, "usage.json"), JSON.stringify({
      history: [{
        provider: "anthropic",
        model: "claude",
        timestamp: today.toISOString(),
        tokens: { prompt_tokens: 2000, completion_tokens: 400, cached_tokens: 700 },
        cost: 0,
      }],
      totalRequestsLifetime: 1,
      dailySummary: {
        [dateKey]: {
          requests: 1,
          promptTokens: 2000,
          completionTokens: 400,
          cost: 0,
          byProvider: { anthropic: { requests: 1, promptTokens: 2000, completionTokens: 400, cost: 0 } },
          byModel: { "claude|anthropic": { requests: 1, promptTokens: 2000, completionTokens: 400, cost: 0, rawModel: "claude", provider: "anthropic" } },
          byAccount: {},
          byApiKey: { "local-no-key|claude|anthropic": { requests: 1, promptTokens: 2000, completionTokens: 400, cost: 0, rawModel: "claude", provider: "anthropic", apiKey: null } },
          byEndpoint: { "Unknown|claude|anthropic": { requests: 1, promptTokens: 2000, completionTokens: 400, cost: 0, endpoint: "Unknown", rawModel: "claude", provider: "anthropic" } },
        },
      },
    }));

    const { getUsageStats } = await import("@/lib/usageDb.js");
    const stats = await getUsageStats("7d");

    expect(stats.totalCachedTokens).toBe(700);
    expect(stats.byProvider.anthropic.cachedTokens).toBe(700);
    expect(stats.byModel["claude (anthropic)"].cachedTokens).toBe(700);
  });

  it("builds active request data without rereading usage db", async () => {
    const usageDb = await import("@/lib/usageDb.js");
    const db = await usageDb.getUsageDb();
    const readSpy = vi.spyOn(db, "read");

    usageDb.trackPendingRequest("claude-3-5-haiku", "anthropic", "conn-1", true);
    readSpy.mockClear();

    const result = await usageDb.getActiveRequests();

    expect(readSpy).not.toHaveBeenCalled();
    expect(result.activeRequests).toEqual([
      {
        model: "claude-3-5-haiku",
        provider: "anthropic",
        account: expect.any(String),
        count: 1,
      },
    ]);
  });

  it("coalesces multiple usage update events into one refresh window", async () => {
    vi.useFakeTimers();

    const statsEmitter = new EventEmitter();
    const getUsageStats = vi.fn(async () => ({ totalRequests: 1 }));
    const getActiveRequests = vi.fn(async () => ({
      activeRequests: [],
      recentRequests: [],
      errorProvider: "",
    }));

    vi.doMock("@/lib/usageDb", () => ({
      getUsageStats,
      getActiveRequests,
      statsEmitter,
    }));

    const { GET } = await import("@/app/api/usage/stream/route.js");
    const response = await GET();
    const reader = response.body.getReader();

    await reader.read();
    getUsageStats.mockClear();

    statsEmitter.emit("update");
    statsEmitter.emit("update");
    statsEmitter.emit("update");

    await vi.advanceTimersByTimeAsync(250);

    expect(getUsageStats).toHaveBeenCalledTimes(1);

    await reader.cancel();
    vi.useRealTimers();
  });

  it("does not use sync fs APIs when appending request logs", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/usageDb");
    vi.doUnmock("@/lib/usageDb.js");

    const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync");
    const readFileSyncSpy = vi.spyOn(fs, "readFileSync");
    const writeFileSyncSpy = vi.spyOn(fs, "writeFileSync");
    const usageDb = await import("@/lib/usageDb.js");

    await usageDb.appendRequestLog({
      model: "claude-3-5-haiku",
      provider: "anthropic",
      connectionId: "conn-1",
      status: "200 OK",
    });

    expect(appendFileSyncSpy).not.toHaveBeenCalled();
    expect(readFileSyncSpy).not.toHaveBeenCalled();
    expect(writeFileSyncSpy).not.toHaveBeenCalled();
  });

  it("deletes zero-count pending request keys after request completion", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/usageDb");
    vi.doUnmock("@/lib/usageDb.js");

    const usageDb = await import("@/lib/usageDb.js");

    usageDb.trackPendingRequest("claude-3-5-haiku", "anthropic", "conn-1", true);
    usageDb.trackPendingRequest("claude-3-5-haiku", "anthropic", "conn-1", false);

    const result = await usageDb.getActiveRequests();

    expect(result.activeRequests).toEqual([]);
    expect(global._pendingRequests.byModel["claude-3-5-haiku (anthropic)"]).toBeUndefined();
    expect(global._pendingRequests.byAccount["conn-1"]?.["claude-3-5-haiku (anthropic)"]).toBeUndefined();
  });

  it("reuses aggregate usage stats within a short cache window", async () => {
    vi.resetModules();

    const getProviderConnections = vi.fn(async () => []);
    const getApiKeys = vi.fn(async () => []);
    const getProviderNodes = vi.fn(async () => []);

    vi.doMock("@/lib/localDb.js", () => ({
      getProviderConnections,
      getApiKeys,
      getProviderNodes,
      getPricingForModel: vi.fn(async () => null),
    }));

    const usageDb = await import("@/lib/usageDb.js");

    await usageDb.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      tokens: { prompt_tokens: 100, completion_tokens: 20 },
      timestamp: new Date().toISOString(),
      endpoint: "/v1/chat/completions",
    });

    getProviderConnections.mockClear();
    getApiKeys.mockClear();
    getProviderNodes.mockClear();

    await usageDb.getUsageStats("7d");
    await usageDb.getUsageStats("7d");

    expect(getProviderConnections).toHaveBeenCalledTimes(1);
    expect(getApiKeys).toHaveBeenCalledTimes(1);
    expect(getProviderNodes).toHaveBeenCalledTimes(1);
  });
});
