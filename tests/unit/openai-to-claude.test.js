/**
 * Unit tests for open-sse/translator/request/openai-to-claude.js
 *
 * Tests cover:
 *  - openaiToClaudeRequest() - OpenAI to Claude request translation
 *  - Response format handling (json_schema, json_object)
 */

import { describe, it, expect } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

describe("openaiToClaudeRequest", () => {
  describe("response_format handling", () => {
    it("should inject JSON schema instructions for json_schema type", () => {
      const body = {
        messages: [{ role: "user", content: "What is 2+2?" }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "math_response",
            schema: {
              type: "object",
              properties: {
                answer: { type: "number" },
                explanation: { type: "string" }
              },
              required: ["answer", "explanation"]
            }
          }
        }
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);

      // Should have system array with instructions
      expect(result.system).toBeDefined();
      expect(Array.isArray(result.system)).toBe(true);
      
      // Check that system prompt includes schema
      const systemText = result.system
        .filter(s => s.type === "text")
        .map(s => s.text)
        .join("\n");
      
      expect(systemText).toContain("You must respond with valid JSON");
      expect(systemText).toContain("\"answer\"");
      expect(systemText).toContain("\"explanation\"");
      expect(systemText).toContain("Respond ONLY with the JSON object");
    });

    it("should inject basic JSON instructions for json_object type", () => {
      const body = {
        messages: [{ role: "user", content: "Give me a JSON object" }],
        response_format: {
          type: "json_object"
        }
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);

      // Should have system array with instructions
      expect(result.system).toBeDefined();
      expect(Array.isArray(result.system)).toBe(true);
      
      const systemText = result.system
        .filter(s => s.type === "text")
        .map(s => s.text)
        .join("\n");
      
      expect(systemText).toContain("You must respond with valid JSON");
      expect(systemText).toContain("Respond ONLY with a JSON object");
    });

    it("should not modify system prompt when response_format is missing", () => {
      const body = {
        messages: [{ role: "user", content: "Hello" }]
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);

      // Should have system but without JSON instructions
      expect(result.system).toBeDefined();
      
      const systemText = result.system
        .filter(s => s.type === "text")
        .map(s => s.text)
        .join("\n");
      
      // Should NOT contain JSON-specific instructions
      expect(systemText).not.toContain("You must respond with valid JSON");
    });

    it("should preserve existing system messages when adding response_format", () => {
      const body = {
        messages: [
          { role: "system", content: "You are a helpful math tutor." },
          { role: "user", content: "What is 2+2?" }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            schema: {
              type: "object",
              properties: {
                result: { type: "number" }
              }
            }
          }
        }
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);

      // Should preserve original system message
      const systemText = result.system
        .filter(s => s.type === "text")
        .map(s => s.text)
        .join("\n");
      
      expect(systemText).toContain("You are a helpful math tutor");
      expect(systemText).toContain("You must respond with valid JSON");
    });
  });

  describe("thinking conversion", () => {
    it("should convert reasoning_effort none to Claude thinking disabled", () => {
      const result = openaiToClaudeRequest("claude-sonnet-4.5", {
        messages: [{ role: "user", content: "Hello" }],
        reasoning_effort: "none"
      }, false);

      expect(result.thinking).toEqual({ type: "disabled" });
    });

    it("should preserve explicit Claude disabled thinking", () => {
      const result = openaiToClaudeRequest("claude-sonnet-4.5", {
        messages: [{ role: "user", content: "Hello" }],
        thinking: { type: "disabled" }
      }, false);

      expect(result.thinking).toEqual({ type: "disabled" });
    });
  });

  describe("tool_choice conversion", () => {
    const baseBody = {
      messages: [{ role: "user", content: "Hello" }],
      tools: [{
        type: "function",
        function: {
          name: "extract_terms",
          parameters: { type: "object", properties: {}, required: [] }
        }
      }]
    };

    it("should convert OpenAI {type:'function'} shape to Claude {type:'tool'}", () => {
      const result = openaiToClaudeRequest("claude-haiku-4-5-20251001", {
        ...baseBody,
        tool_choice: { type: "function", function: { name: "extract_terms" } }
      }, false);
      expect(result.tool_choice).toEqual({ type: "tool", name: "extract_terms" });
    });

    it("should convert string 'required' to {type:'any'}", () => {
      const result = openaiToClaudeRequest("claude-haiku-4-5-20251001", {
        ...baseBody,
        tool_choice: "required"
      }, false);
      expect(result.tool_choice).toEqual({ type: "any" });
    });

    it("should convert string 'auto' to {type:'auto'}", () => {
      const result = openaiToClaudeRequest("claude-haiku-4-5-20251001", {
        ...baseBody,
        tool_choice: "auto"
      }, false);
      expect(result.tool_choice).toEqual({ type: "auto" });
    });

    it("should convert string 'none' to {type:'auto'}", () => {
      const result = openaiToClaudeRequest("claude-haiku-4-5-20251001", {
        ...baseBody,
        tool_choice: "none"
      }, false);
      expect(result.tool_choice).toEqual({ type: "auto" });
    });

    it("should passthrough already-valid Claude shape {type:'tool'}", () => {
      const result = openaiToClaudeRequest("claude-haiku-4-5-20251001", {
        ...baseBody,
        tool_choice: { type: "tool", name: "extract_terms" }
      }, false);
      expect(result.tool_choice).toEqual({ type: "tool", name: "extract_terms" });
    });
  });
});