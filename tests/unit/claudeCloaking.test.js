/**
 * Unit tests for open-sse/utils/claudeCloaking.js
 *
 * Tests cover:
 *  - cloakClaudeTools() — tool renaming, tool_choice.name suffix, message history renaming
 *  - applyCloaking()    — billing header injection, stable per-process hash
 */

import { describe, it, expect } from "vitest";
import { cloakClaudeTools, applyCloaking } from "../../open-sse/utils/claudeCloaking.js";
import { CLAUDE_TOOL_SUFFIX } from "../../open-sse/config/appConstants.js";

const TOOL = {
  name: "extract_terms",
  description: "Extract key terms",
  input_schema: { type: "object", properties: {}, required: [] }
};

describe("cloakClaudeTools", () => {
  it("should append suffix to tool declarations", () => {
    const { body } = cloakClaudeTools({ tools: [TOOL], messages: [] });
    const clientTool = body.tools.find(t => t.name === `extract_terms${CLAUDE_TOOL_SUFFIX}`);
    expect(clientTool).toBeDefined();
  });

  it("should build a reverse toolNameMap (suffixed → original)", () => {
    const { toolNameMap } = cloakClaudeTools({ tools: [TOOL], messages: [] });
    expect(toolNameMap.get(`extract_terms${CLAUDE_TOOL_SUFFIX}`)).toBe("extract_terms");
  });

  it("should append suffix to tool_choice.name when type is 'tool'", () => {
    const body = {
      tools: [TOOL],
      messages: [],
      tool_choice: { type: "tool", name: "extract_terms" }
    };
    const { body: cloaked } = cloakClaudeTools(body);
    expect(cloaked.tool_choice).toEqual({
      type: "tool",
      name: `extract_terms${CLAUDE_TOOL_SUFFIX}`
    });
  });

  it("should not double-suffix tool_choice.name if already suffixed", () => {
    const alreadySuffixed = `extract_terms${CLAUDE_TOOL_SUFFIX}`;
    const body = {
      tools: [TOOL],
      messages: [],
      tool_choice: { type: "tool", name: alreadySuffixed }
    };
    const { body: cloaked } = cloakClaudeTools(body);
    expect(cloaked.tool_choice.name).toBe(alreadySuffixed);
  });

  it("should leave tool_choice unchanged when type is not 'tool'", () => {
    const body = { tools: [TOOL], messages: [], tool_choice: { type: "auto" } };
    const { body: cloaked } = cloakClaudeTools(body);
    expect(cloaked.tool_choice).toEqual({ type: "auto" });
  });

  it("should append suffix to tool_use blocks in message history", () => {
    const body = {
      tools: [TOOL],
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "extract_terms", input: {} }] }
      ]
    };
    const { body: cloaked } = cloakClaudeTools(body);
    const block = cloaked.messages[0].content[0];
    expect(block.name).toBe(`extract_terms${CLAUDE_TOOL_SUFFIX}`);
  });

  it("should inject CC decoy tools after client tools", () => {
    const { body } = cloakClaudeTools({ tools: [TOOL], messages: [] });
    const decoy = body.tools.find(t => t.name === "Bash");
    expect(decoy).toBeDefined();
    expect(decoy.description).toBe("This tool is currently unavailable.");
  });

  it("should return null toolNameMap when no tools provided", () => {
    const { toolNameMap } = cloakClaudeTools({ tools: [], messages: [] });
    expect(toolNameMap).toBeNull();
  });
});

describe("applyCloaking", () => {
  it("should inject billing header as system[0] for sk-ant-oat tokens", () => {
    const body = { messages: [] };
    const result = applyCloaking(body, "sk-ant-oat--test");
    expect(Array.isArray(result.system)).toBe(true);
    expect(result.system[0].text).toMatch(/^x-anthropic-billing-header:/);
  });

  it("should not modify body for non-OAuth tokens", () => {
    const body = { messages: [], system: [{ type: "text", text: "hello" }] };
    const result = applyCloaking(body, "sk-ant-api03-test");
    expect(result).toBe(body);
  });

  it("should preserve existing system blocks after billing header", () => {
    const existing = { type: "text", text: "You are helpful." };
    const body = { messages: [], system: [existing] };
    const result = applyCloaking(body, "sk-ant-oat--test");
    expect(result.system.length).toBeGreaterThanOrEqual(2);
    expect(result.system[1]).toEqual(existing);
  });

  it("should not re-inject billing header if already present", () => {
    const body = { messages: [] };
    const once = applyCloaking(body, "sk-ant-oat--test");
    const twice = applyCloaking(once, "sk-ant-oat--test");
    const billingBlocks = twice.system.filter(b => b.text?.startsWith("x-anthropic-billing-header:"));
    expect(billingBlocks.length).toBe(1);
  });

  it("should produce identical billing header across two calls (stable hash)", () => {
    const body = { messages: [] };
    const r1 = applyCloaking(body, "sk-ant-oat--test");
    const r2 = applyCloaking({ messages: [] }, "sk-ant-oat--test");
    expect(r1.system[0].text).toBe(r2.system[0].text);
  });

  it("should inject fake user_id into metadata", () => {
    const body = { messages: {} };
    const result = applyCloaking(body, "sk-ant-oat--test");
    expect(result.metadata?.user_id).toBeDefined();
    expect(result.metadata.user_id).toContain("device_id");
  });
});
