# Anthropic prompt-cache diagnostic

Temporary instrumentation to investigate why upstream Anthropic returns
`cache_read_input_tokens=0` on every call (Round 1–3 fixes did not
resolve this; reporter Step A asks for raw upstream usage data).

This logging is **off by default**. Enable per process by setting
`CACHE_DIAG=1`. Disable by unsetting / setting any other value.

```bash
CACHE_DIAG=1 PORT=20128 npm run dev
# or
CACHE_DIAG=1 npm run start
```

## What gets logged

When `provider === "claude"`:

| Stage | Where | Tag |
|-------|-------|-----|
| Outgoing request shape | `executors/base.js` (just before `fetch`) | `[CACHE-DIAG req]` |
| Non-streaming raw `usage` from Anthropic | `handlers/chatCore/nonStreamingHandler.js` (after JSON parse) | `[CACHE-DIAG usage]` label `non-streaming` |
| Streaming `message_start.usage` | `translator/response/claude-to-openai.js` | `[CACHE-DIAG usage]` label `message_start` |
| Streaming `message_delta.usage` | `translator/response/claude-to-openai.js` | `[CACHE-DIAG usage]` label `message_delta` |

`[CACHE-DIAG req]` redacts `Authorization` / `x-api-key` to a 12-char prefix
+ length so output can be shared. It does **not** dump full system prompt
text — only block type, length, first 50 chars, `cache_control` flag, and
TTL. Full body dump (Step C) is intentionally not implemented to avoid
leaking conversation content.

## How to interpret 3 sequential identical calls

```
Call 1 (cold) → cache_creation_input_tokens > 0,  cache_read_input_tokens = 0
Call 2 (warm) → cache_creation_input_tokens = 0,  cache_read_input_tokens > 0
Call 3 (warm) → cache_creation_input_tokens = 0,  cache_read_input_tokens > 0
```

| Observed | Diagnosis | Next step |
|----------|-----------|-----------|
| Call 2/3 `cache_read > 0` in `[CACHE-DIAG usage]` but OpenAI `prompt_tokens_details.cached_tokens` is missing downstream | Forwarding bug in proxy (not a cache miss) | Trace `prompt_tokens_details` build path |
| All 3 calls `cache_creation > 0` | Prefix variability — cache key changes per call | Diff `[CACHE-DIAG req]` `system` summaries call-to-call |
| All 3 calls `cache_creation = 0` and `cache_read = 0` | Anthropic side: account/scope not caching | File ticket; no proxy fix |

## Removing the instrumentation

The diagnostic is intentionally one module + 4 call-site one-liners so it
reverts cleanly. Once root cause is known, revert this branch (or remove
imports + the helper module).

Files touched:
- `open-sse/utils/cacheDiag.js` (new)
- `open-sse/executors/base.js`
- `open-sse/handlers/chatCore/nonStreamingHandler.js`
- `open-sse/translator/response/claude-to-openai.js`
