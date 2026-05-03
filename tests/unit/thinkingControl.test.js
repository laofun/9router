import { describe, it, expect } from "vitest";
import { normalizeThinkingConfig } from "../../open-sse/services/provider.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { openaiToGeminiCLIRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { GithubExecutor } from "../../open-sse/executors/github.js";

describe("request-level thinking control", () => {
  it("preserves explicit disabled thinking when last message is not user", () => {
    const body = {
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Done" }
      ],
      thinking: { type: "disabled" }
    };

    const result = normalizeThinkingConfig({ ...body, thinking: { ...body.thinking } });

    expect(result.thinking).toEqual({ type: "disabled" });
  });

  it("preserves reasoning_effort none when last message is not user", () => {
    const body = {
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Done" }
      ],
      reasoning_effort: "none"
    };

    const result = normalizeThinkingConfig({ ...body });

    expect(result.reasoning_effort).toBe("none");
  });

  it("translates reasoning_effort none to Claude thinking disabled", () => {
    const result = openaiToClaudeRequest("claude-sonnet-4.5", {
      messages: [{ role: "user", content: "Hello" }],
      reasoning_effort: "none"
    }, false);

    expect(result.thinking).toEqual({ type: "disabled" });
  });

  it("does not create Gemini CLI thinkingConfig for reasoning_effort none", () => {
    const result = openaiToGeminiCLIRequest("gemini-2.5-flash", {
      messages: [{ role: "user", content: "Hello" }],
      reasoning_effort: "none"
    }, false);

    expect(result.generationConfig.thinkingConfig).toBeUndefined();
  });

  it("keeps Codex explicit none instead of defaulting to low", () => {
    const executor = new CodexExecutor();
    const result = executor.transformRequest("gpt-5.3-codex", {
      model: "gpt-5.3-codex",
      input: "Hello",
      reasoning_effort: "none"
    }, false, null);

    expect(result.reasoning).toEqual({ effort: "none", summary: "auto" });
    expect(result.include).toBeUndefined();
  });

  it("keeps GitHub reasoning_effort none for GPT-5 models", () => {
    const executor = new GithubExecutor();
    const result = executor.transformRequest("gpt-5", {
      model: "gpt-5",
      messages: [{ role: "user", content: "Hello" }],
      reasoning_effort: "none"
    }, false, null);

    expect(result.reasoning_effort).toBe("none");
  });
});
