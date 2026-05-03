# Tools / Function-calling Deep Dive — OpenAI proxy path

**Status:** Findings verified by source read. Two bugs (B1, B2), four hot-spots, one confirmed regression-risk.
**Date:** 2026-04-30
**Branch:** master (commit `b713862` baseline)
**Scope:** request reaching `/v1/chat/completions` in OpenAI shape; tool/function-calling handling end-to-end across translators, cloaking, executors, and stream conversion.

## Pipeline overview

```
client (OpenAI body w/ tools)
  → /api/v1/chat/completions/route.js          (CORS + initTranslators + handoff)
  → src/sse/handlers/chat.js                   (auth, settings, combo, account fallback)
  → open-sse/handlers/chatCore.js              (format detect, passthrough check, translateRequest, executor.execute)
  → translator/index.js → openai-to-{claude|gemini|...}.js    (request translation; tool name mapping; _toolNameMap attached to body)
  → claudeHelper.prepareClaudeRequest           (cleanup, cache_control, fixToolUseOrdering)
  → claudeCloaking.cloakClaudeTools             (only for provider==="claude" + OAuth → suffix client tools w/ "_ide", inject 20 decoys, OVERWRITES _toolNameMap)
  → executors/{default|codex|...}.execute       (build URL, headers, sign, fetch)
  → stream.js createSSEStream                   (translate or passthrough; per-stream state holds toolNameMap)
  → response/{claude|gemini}-to-openai.js       (state.toolNameMap?.get(name) || name → emits OpenAI tool_calls deltas)
  → handleNonStreamingResponse                  (decloakToolNames on raw Claude body BEFORE translateNonStreamingResponse)
```

References below are to master (`d67888f` workspace state).

---

## Verified observations

### ✅ A. Tool name round-trip via `_toolNameMap`

- `openai-to-claude.js:13,154,203` — request-side: builds `toolNameMap` (prefix→original), attaches as `result._toolNameMap`. With `CLAUDE_OAUTH_TOOL_PREFIX = ""` (line 8) entries are `name → name` — *no-op rename*.
- `translator/index.js:135-138` — when `provider === "claude"` + OAuth, calls `cloakClaudeTools()` which **OVERWRITES `result._toolNameMap`** with `name+"_ide" → name`.
- `chatCore.js:90-91` — extracts `_toolNameMap`, deletes from translatedBody, threads it through `handleStreamingResponse` / `handleNonStreamingResponse`.
- Streaming: `stream.js:55` stores in `state.toolNameMap`. `response/claude-to-openai.js:71` looks up `state.toolNameMap?.get(block.name) || block.name` to recover original.
- Non-streaming: `nonStreamingHandler.js:169` calls `decloakToolNames(responseBody, toolNameMap)` BEFORE translateNonStreamingResponse. This strips `_ide` on raw Claude body.

**Verdict:** Round-trip is correct for `OpenAI client → claude OAuth provider` in both stream and non-stream paths.

### ✅ B. tool_choice translation (Round 1 + Round 2 fixes hold)

- `openai-to-claude.js:295-307` — `convertOpenAIToolChoice`: `{type:"function",function:{name:X}}` → `{type:"tool",name:X}`; `"required"` → `{type:"any"}`; passthrough for already-Claude shapes.
- `claudeCloaking.js:71-74` — appends `_ide` to `tool_choice.name` when `type==="tool"` so it matches the renamed declaration.

### ✅ C. Tool ordering / merging in OpenAI→Claude

- `openai-to-claude.js:42-86` — explicit flush logic guarantees: `tool_result` blocks land in their own `user` message immediately after the `tool_use`-bearing assistant message; consecutive same-role merges respect this.
- `claudeHelper.fixToolUseOrdering` (`claudeHelper.js:23-77`) — second pass strips text *after* `tool_use` in assistant content (Claude API rejects it) and merges consecutive same-role messages with `tool_result` first.
- Cache_control: `openai-to-claude.js:91-105` adds ephemeral on last assistant block; `claudeHelper.js:131-148` re-applies during prepareClaudeRequest. Tools last-block gets `ttl:"1h"` (`openai-to-claude.js:163-165`, `claudeHelper.js:184-189`).

### ✅ D. Anthropic decoy injection

`claudeCloaking.js:55, 95-116` — 20 hard-coded CC default tool names (`Bash`, `Read`, `Edit`, `WebSearch`, `Skill`, …) appended after client tools, marked `"This tool is currently unavailable."`. Client tools all carry `_ide` suffix so name collision with a decoy is impossible.

### ✅ E. Native passthrough avoids translation entirely

`chatCore.js:76-93` — if `detectClientTool(headers, body)` matches the provider's ecosystem (e.g. Claude Code → claude provider), `translatedBody = { ...body, model }` and translateRequest never runs ⇒ no cloak, no `_toolNameMap`. Tool names pass through untouched. Stream goes through `createPassthroughStreamWithLogger`.

---

## 🔴 Bugs / risks

### B1 — Dead-code prefix mismatch in `openai-to-claude` response translator

**File:** `open-sse/translator/response/openai-to-claude.js:5,154-156`

```js
const CLAUDE_OAUTH_TOOL_PREFIX = "proxy_";
...
let toolName = tc.function?.name || "";
if (toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)) {
  toolName = toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length);
}
```

vs `request/openai-to-claude.js:8` — `const CLAUDE_OAUTH_TOOL_PREFIX = "";` and the matching strip at lines 345/363 of the request-for-Antigravity path.

**Direction this code runs:** `Claude-format client → OpenAI provider`. Response translator builds Claude-shaped chunks from OpenAI tool_calls. The "strip" is a relic of the era when the request side prepended `proxy_`. Since the request side now uses an empty prefix, an OpenAI provider will never echo `proxy_<tool>` back. The branch is dead but **also wrong if any tool happens to be named `proxy_xxx` for unrelated reasons** — its prefix would be silently mangled.

**Severity:** LOW. Easy to delete: collapse `toolName` to `tc.function?.name || ""`.

### B2 — Claude→Claude streaming + OAuth cloak leaks `_ide` to client

**Files:** `translator/index.js:132-141`, `handlers/chatCore/streamingHandler.js:32-37`, `utils/stream.js:78-169` (passthrough mode), `claudeCloaking.js:40-80`

When `sourceFormat === FORMATS.CLAUDE && targetFormat === FORMATS.CLAUDE`:

1. `chatCore.js:76` runs `detectClientTool` + `isNativePassthrough`. If the client is **not** identified as Claude Code (e.g. a generic Anthropic-shape client), `passthrough = false`.
2. `translateRequest` runs even though sourceFormat===targetFormat (line 98 only short-circuits the *step pair*, not cloaking). For `provider==="claude"` + OAuth, `cloakClaudeTools` renames every tool with `_ide`, mutates message history, and adds 20 decoys.
3. Streaming: `streamingHandler.js:32` — `needsTranslation(targetFormat, sourceFormat)` is **false** ⇒ `createPassthroughStreamWithLogger` is used.
4. `stream.js` passthrough mode (lines 78-169) **never invokes `decloakToolNames` and never consults `state.toolNameMap`** — it forwards SSE chunks normalized but unmodified. Client receives `tool_use { name: "Read_ide" }` etc.

Non-streaming path is fine (`nonStreamingHandler.js:169` calls `decloakToolNames` unconditionally).

**Repro likelihood:** Low for typical user (Claude Code is the dominant Claude client and gets passthrough), but real for any non-CC Claude-shape integration on Anthropic OAuth.

**Fix sketches:**
- (a) `cloakClaudeTools` should not run when `sourceFormat === FORMATS.CLAUDE && targetFormat === FORMATS.CLAUDE` and the client wasn't detected as CC — but losing cloaking risks fingerprint detection.
- (b) Better: in `streamingHandler.buildTransformStream`, when source===target===CLAUDE *and* `toolNameMap` is non-empty, force `createSSETransformStreamWithLogger(CLAUDE, CLAUDE, ...)` and add a CLAUDE→CLAUDE pass-through-with-decloak translator that just rewrites `tool_use.name` via the map.
- (c) Or: post-process buffers in passthrough mode when `toolNameMap` is set — extract `tool_use` events, rewrite `name`. Lightest patch but couples passthrough to Claude SSE schema.

### R1 — Gemini name sanitization is irreversible (no map kept)

**File:** `open-sse/translator/request/openai-to-gemini.js:26-36, 134, 174, 198, 208, 366, 377, 408`

Every Gemini path passes tool/function names through `sanitizeGeminiFunctionName` (replaces `[^a-zA-Z0-9_.:\-]` with `_`, ensures alpha/underscore start, truncates to 64). **The original name is never recorded anywhere.**

`response/gemini-to-openai.js:64,114` and `nonStreamingHandler.js:35` look up `state.toolNameMap?.get(rawName) || rawName`. With no map populated for Gemini sanitization, the sanitized name is what reaches the OpenAI client.

Practical impact:
- OpenAI clients that already constrain to `^[a-zA-Z0-9_-]{1,64}$` send valid names ⇒ sanitize is a no-op ⇒ harmless.
- Claude clients allow `_-` and a few extra; usually still safe.
- Clients sending names with `.`, `:`, `+`, `@`, parens, unicode etc. (Anthropic accepts more permissive characters) WILL see the response tool_call name diverge from their own declaration ⇒ subsequent tool_result with `tool_call_id` may look up the wrong name when `openai-to-gemini` re-sanitizes on the next turn (line 153-160 reconstructs name from id-suffix when missing — name lookup `tcID2Name[fid]` already holds *unsanitized* name from the assistant message, so the next turn re-sanitizes consistently). End state: the client's tool name gets mangled but a same-conversation round-trip is consistent because the mangling is deterministic.

**Severity:** LOW-MEDIUM. Latent until a client uses non-`[a-zA-Z0-9_-]` characters. Fix: build `_toolNameMap` (`sanitized → original`) inside `openaiToGeminiBase` and attach to result, mirroring openai-to-claude.

### R2 — `tool_use_id` not in any map (intentional, but worth documenting)

`tool_use.id` / `tool_call.id` is preserved verbatim across all translators and through cloaking (`claudeCloaking.js` doesn't touch ids). This is correct: ids are opaque correlation keys, not fingerprints. Just confirming there is no hidden id-rewrite that could break client-side tool_result threading.

### R3 — `toolCallIndex` resets per chunk in claude-to-openai stream

`response/claude-to-openai.js:42` — on each `message_start` chunk, `state.toolCallIndex = 0`. Fine because Claude streams emit a single `message_start`. But if a connection somehow sees two `message_start` events in one stream (provider misbehavior, retry-mid-stream), tool indices would collide on the OpenAI side. No verified incident, just an edge case.

---

## ⚠️ Hot-spots flagged but verified correct

| # | Concern | Verification |
|---|---|---|
| H1 | `assistant.tool_calls` mixed with `content` text → blocks get split between assistant messages | `openai-to-claude.js:81-86` flushes after tool_use; `claudeHelper.fixToolUseOrdering:27-51` strips text *after* tool_use in same message — combined behavior is correct |
| H2 | `tool_choice` shape lost during `filterToOpenAIFormat` (Claude→OpenAI provider) | `openaiHelper.js:113-123` translates `{type:"tool",name}` → `{type:"function",function:{name}}` and `any`/`auto` correctly |
| H3 | `tool_choice` survives empty-tools pruning | `claudeHelper.js:192-196` deletes both when tools array becomes empty after stripping built-in tools |
| H4 | RTK compression breaks tool_result | `translator/index.js:79-83` runs `compressMessages` before any translator; need to read `open-sse/rtk/index.js` to confirm tool_result content is preserved in-shape — **NOT verified in this pass, recommend follow-up** |
| H5 | OpenAI provider sends tool_calls with `id: null` first chunk | `response/openai-to-claude.js:145-167` only opens a tool block when `tc.id` arrives; `tc.function.arguments` deltas before id are dropped — correct OpenAI behavior is `id` always in first delta |
| H6 | Multiple parallel `tool_calls` in one OpenAI delta | `openai-to-claude.js:141-180` iterates `delta.tool_calls`, indexes by `tc.index` — handles parallel correctly |

---

## Recommended follow-ups (sorted by ROI)

1. **Delete B1** (4 lines): unify the prefix constant or hard-delete the strip block from `response/openai-to-claude.js`. Pure cleanup.
2. **Fix B2** (Claude→Claude streaming decloak): pick option (b) above — cheapest, surgical, won't disturb passthrough for native CC.
3. **Patch R1** (Gemini name map): mirror openai-to-claude — record `original → sanitized` map, attach `_toolNameMap` keyed by sanitized name. Net code: ~10 LOC.
4. **Audit RTK** (H4): open `open-sse/rtk/compress.js` and verify `tool_result` content shape (especially `block.content` arrays) survives compression intact. Out of scope for this pass.
5. **Add tests:** a Claude-format client + OAuth + streaming + tool call → assert client sees original tool name (would have caught B2).

---

## Re-verification commands

```bash
# B1: prefix mismatch
grep -n CLAUDE_OAUTH_TOOL_PREFIX open-sse/translator/request/openai-to-claude.js \
                                  open-sse/translator/response/openai-to-claude.js

# B2: passthrough stream skips decloak
grep -n "decloakToolNames\|toolNameMap" open-sse/utils/stream.js  # expect 1 ref (storage), no decloak call

# R1: Gemini sanitization without map
grep -n "_toolNameMap\|sanitizeGeminiFunctionName" open-sse/translator/request/openai-to-gemini.js

# Cloak path
grep -n "cloakClaudeTools\|applyCloaking" open-sse/translator/index.js \
                                          open-sse/translator/helpers/claudeHelper.js \
                                          open-sse/utils/claudeCloaking.js

# Stream toolNameMap propagation (chatCore → streamingHandler → stream.js)
grep -n "toolNameMap" open-sse/handlers/chatCore.js \
                     open-sse/handlers/chatCore/streamingHandler.js \
                     open-sse/handlers/chatCore/nonStreamingHandler.js \
                     open-sse/utils/stream.js
```

## TL;DR

The OpenAI→Claude tool path is correct for the dominant case (OpenAI client → Claude OAuth, streaming or not). Two real bugs deserve patches: dead-code prefix strip in `openai-to-claude` *response* translator (B1, trivial), and `_ide` suffix leak in Claude→Claude streaming when client isn't detected as CC (B2, needs a tiny stream filter). Gemini sanitization is correct in practice but should record a name map for safety (R1). RTK + tool_result interaction was *not* verified in this pass and is the next thing to audit.
