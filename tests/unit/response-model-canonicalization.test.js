import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";

describe("response model canonicalization", () => {
  it("canonicalizes Claude stream model aliases before emitting OpenAI chunks", () => {
    const state = {
      ...initState(FORMATS.OPENAI),
      model: "cc/claude-opus-4-7",
    };

    const chunk = {
      type: "message_start",
      message: {
        id: "msg_123",
        model: "cc/claude-opus-4-7",
        usage: { input_tokens: 10 },
      },
    };

    translateResponse(
      FORMATS.CLAUDE,
      FORMATS.OPENAI,
      chunk,
      state,
    );

    expect(chunk.message.model).toBe("claude-opus-4-7");
    expect(state.model).toBe("claude-opus-4-7");
  });

  it("canonicalizes model aliases before emitting Responses API events", () => {
    const state = {
      ...initState(FORMATS.OPENAI_RESPONSES),
      model: "cc/claude-opus-4-7",
    };

    const events = translateResponse(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      {
        id: "chatcmpl_123",
        choices: [
          {
            index: 0,
            delta: { content: "hello" },
          },
        ],
      },
      state,
    );

    expect(state.model).toBe("claude-opus-4-7");
    expect(events.length).toBeGreaterThan(0);
  });
});
