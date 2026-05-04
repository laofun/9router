import { beforeEach, describe, expect, it, vi } from "vitest";

let capturedBody;

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: false,
    async execute({ body }) {
      capturedBody = body;
      return {
        response: new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "tools.30.model: cc/claude-opus-4-7"
            }
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        ),
        url: "https://api.anthropic.com/v1/messages?beta=true",
        headers: {},
        transformedBody: body
      };
    }
  })
}));

vi.mock("@/lib/usageDb", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve())
}));

describe("Claude native passthrough tool sanitization", () => {
  beforeEach(() => {
    capturedBody = undefined;
  });

  it("strips unsupported model fields from Claude Code custom tools before upstream passthrough", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore({
      body: {
        model: "cc/claude-opus-4-7",
        stream: true,
        messages: [
          { role: "user", content: [{ type: "text", text: "hello" }] }
        ],
        tools: [
          {
            name: "bash",
            description: "Run shell commands",
            input_schema: { type: "object", properties: {}, required: [] }
          },
          {
            type: "custom",
            name: "code_interpreter",
            description: "Execute code",
            input_schema: {
              type: "object",
              properties: { code: { type: "string" } },
              required: ["code"]
            },
            model: "cc/claude-opus-4-7"
          },
          {
            type: "advisor_20260301",
            name: "advisor",
            model: "cc/claude-opus-4-7"
          }
        ]
      },
      modelInfo: { provider: "claude", model: "claude-opus-4-7" },
      credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      clientRawRequest: { headers: { "user-agent": "claude-code/1.0" } },
      connectionId: "conn-1",
      stream: true
    });

    expect(capturedBody.tools).toEqual([
      {
        name: "bash",
        description: "Run shell commands",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        type: "custom",
        name: "code_interpreter",
        description: "Execute code",
        input_schema: {
          type: "object",
          properties: { code: { type: "string" } },
          required: ["code"]
        }
      },
      {
        type: "advisor_20260301",
        name: "advisor",
        model: "claude-opus-4-7"
      }
    ]);
  });
});
