/**
 * Unit tests for translateNonStreamingResponse — Gemini/Antigravity tool name decloaking.
 *
 * Regression: non-streaming Gemini responses emitted suffixed tool names (e.g. "extract_terms_ide")
 * to the client because toolNameMap was not passed through the non-streaming translation path.
 */

import { describe, it, expect } from "vitest";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function makeGeminiBody(toolName) {
  return {
    candidates: [{
      content: {
        parts: [{ functionCall: { name: toolName, args: { text: "hello" } } }],
        role: "model"
      },
      finishReason: "STOP"
    }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 }
  };
}

describe("translateNonStreamingResponse — Gemini tool name decloaking", () => {
  it("should strip _ide suffix from tool call name when toolNameMap is provided", () => {
    const toolNameMap = new Map([["extract_terms_ide", "extract_terms"]]);
    const body = makeGeminiBody("extract_terms_ide");

    const result = translateNonStreamingResponse(body, FORMATS.GEMINI, FORMATS.OPENAI, toolNameMap);

    expect(result.choices[0].message.tool_calls[0].function.name).toBe("extract_terms");
  });

  it("should strip _ide suffix from tool call id as well", () => {
    const toolNameMap = new Map([["extract_terms_ide", "extract_terms"]]);
    const body = makeGeminiBody("extract_terms_ide");

    const result = translateNonStreamingResponse(body, FORMATS.GEMINI, FORMATS.OPENAI, toolNameMap);

    expect(result.choices[0].message.tool_calls[0].id).toContain("extract_terms");
    expect(result.choices[0].message.tool_calls[0].id).not.toContain("_ide");
  });

  it("should use raw name as fallback when name is not in toolNameMap", () => {
    const toolNameMap = new Map([["other_tool_ide", "other_tool"]]);
    const body = makeGeminiBody("extract_terms_ide");

    const result = translateNonStreamingResponse(body, FORMATS.GEMINI, FORMATS.OPENAI, toolNameMap);

    expect(result.choices[0].message.tool_calls[0].function.name).toBe("extract_terms_ide");
  });

  it("should behave correctly with no toolNameMap (null)", () => {
    const body = makeGeminiBody("my_tool");

    const result = translateNonStreamingResponse(body, FORMATS.GEMINI, FORMATS.OPENAI, null);

    expect(result.choices[0].message.tool_calls[0].function.name).toBe("my_tool");
  });

  it("should apply decloaking for ANTIGRAVITY format too", () => {
    const toolNameMap = new Map([["search_ide", "search"]]);
    const body = makeGeminiBody("search_ide");

    const result = translateNonStreamingResponse(body, FORMATS.ANTIGRAVITY, FORMATS.OPENAI, toolNameMap);

    expect(result.choices[0].message.tool_calls[0].function.name).toBe("search");
  });
});
