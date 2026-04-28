# n9router — 2 bugs blocking Anthropic Claude features

> **Reporter**: novel-pj-01 (Chinese→Vietnamese translator using n9router as OpenAI-compat proxy at `localhost:20128/v1`)
> **Date**: 2026-04-28
> **Impact**: Cannot use native function calling on Claude; cannot measure prompt-cache hit rate.

---

## Bug 1 — `tool_choice` translation forwards OpenAI format unchanged → Claude returns 400

### Empirical evidence

Client sends:
```python
client.chat.completions.create(
    model="cc/claude-haiku-4-5-20251001",
    messages=[...],
    tools=[{"type": "function", "function": {"name": "extract_terms", "parameters": {...}}}],
    tool_choice={"type": "function", "function": {"name": "extract_terms"}},  # OpenAI shape
)
```

Response from n9router (forwarded from upstream):
```
HTTP 400 — "tool_choice: Input tag 'function' found using 'type' does not match
expected tags: 'auto', 'any', 'tool'"
```

Same error happens with `tool_choice="auto"` (string form), suggesting the *fallback* path also produces something Claude rejects, but the message points specifically at `'function'` shape — meaning at least one input variant is being passed through verbatim.

### Root cause

**File**: `open-sse/translator/request/openai-to-claude.js`
**Function**: `convertOpenAIToolChoice` (lines 275–285)

```javascript
function convertOpenAIToolChoice(choice) {
  if (!choice) return { type: "auto" };
  if (typeof choice === "object" && choice.type) return choice;  // ← BUG
  if (choice === "auto" || choice === "none") return { type: "auto" };
  if (choice === "required") return { type: "any" };
  if (typeof choice === "object" && choice.function) {
    return { type: "tool", name: choice.function.name };
  }
  return { type: "auto" };
}
```

Line 278's guard `choice.type` short-circuits **before** the proper conversion at line 281. When client sends `{type: "function", function: {name: "X"}}`, the function returns it verbatim. Claude API only accepts `type ∈ {"auto", "any", "tool"}`.

### Proposed fix

Re-order so the OpenAI `function` shape is detected first. One option:

```javascript
function convertOpenAIToolChoice(choice) {
  if (!choice) return { type: "auto" };
  if (typeof choice === "string") {
    if (choice === "required") return { type: "any" };
    return { type: "auto" };  // covers "auto" and "none"
  }
  if (typeof choice === "object") {
    // OpenAI: {type: "function", function: {name}}
    if (choice.type === "function" && choice.function?.name) {
      return { type: "tool", name: choice.function.name };
    }
    // Already Anthropic shape: {type: "tool"|"any"|"auto", ...}
    if (["tool", "any", "auto"].includes(choice.type)) return choice;
  }
  return { type: "auto" };
}
```

### Test case

```python
# Should succeed instead of 400
r = client.chat.completions.create(
    model="cc/claude-haiku-4-5-20251001",
    messages=[{"role":"user","content":"List 3 colors."}],
    tools=[{
        "type": "function",
        "function": {
            "name": "list_colors",
            "parameters": {"type":"object","properties":{"colors":{"type":"array","items":{"type":"string"}}},"required":["colors"]},
        },
    }],
    tool_choice={"type": "function", "function": {"name": "list_colors"}},
)
assert r.choices[0].message.tool_calls is not None
```

---

## Bug 2 — `prompt_tokens_details.cached_tokens` not forwarded in `message_stop` fallback

### Empirical evidence

Client sends a Claude request with `cache_control: {type: "ephemeral"}` markers on the system block. Same request sent twice back-to-back.

Both responses return:
```json
{
  "completion_tokens": 19,
  "prompt_tokens": 5360,
  "total_tokens": 5379,
  "completion_tokens_details": null,
  "prompt_tokens_details": null    ← missing
}
```

Cache may be hitting upstream but **client cannot observe it**. This blocks all cache-cost-savings auditing and any cost-aware routing logic.

### Root cause

**File**: `open-sse/translator/response/claude-to-openai.js`

There are TWO code paths that build the final usage object from a Claude streaming response:

**Path A — `message_delta` event handler (lines 159–171)** — works correctly:
```javascript
const cacheRead = state.usage.cache_read_input_tokens;
const cacheCreate = state.usage.cache_creation_input_tokens;
if (cacheRead > 0 || cacheCreate > 0) {
  finalChunk.usage.prompt_tokens_details = {};
  if (cacheRead > 0) finalChunk.usage.prompt_tokens_details.cached_tokens = cacheRead;
  if (cacheCreate > 0) finalChunk.usage.prompt_tokens_details.cache_creation_tokens = cacheCreate;
}
```

**Path B — `message_stop` fallback (lines 180–205)** — missing the cache-token block:
```javascript
const usageObj = (state.usage && typeof state.usage === 'object') ? {
  usage: {
    prompt_tokens: state.usage.input_tokens || 0,
    completion_tokens: state.usage.output_tokens || 0,
    total_tokens: (state.usage.input_tokens || 0) + (state.usage.output_tokens || 0)
    // ← no prompt_tokens_details
  }
} : {};
```

When the stream ends without firing `message_delta` (or when `finishReason` isn't sent in the delta), the fallback produces a usage object lacking `prompt_tokens_details`. Empirically this appears to be the **common path** — short Claude responses to short user prompts seem to hit Path B.

### Proposed fix

Mirror the cache-token logic from Path A:

```javascript
// After the existing usage object is built in message_stop handler:
const cacheRead = state.usage.cache_read_input_tokens || 0;
const cacheCreate = state.usage.cache_creation_input_tokens || 0;
if (cacheRead > 0 || cacheCreate > 0) {
  usageObj.usage.prompt_tokens_details = {};
  if (cacheRead > 0) usageObj.usage.prompt_tokens_details.cached_tokens = cacheRead;
  if (cacheCreate > 0) usageObj.usage.prompt_tokens_details.cache_creation_tokens = cacheCreate;
}
```

Also worth refactoring: extract a single `buildUsageWithCache(claudeUsage)` helper so the two paths can't drift again.

### Test case

```python
import time
# Build a system block large enough to cache (Anthropic minimum: 1024 tokens)
big_system = [{"type": "text", "text": "Translate zh→vi.\n" * 300, "cache_control": {"type": "ephemeral"}}]

# Call 1 — primes cache
r1 = client.chat.completions.create(
    model="cc/claude-haiku-4-5-20251001",
    messages=[{"role":"system","content":big_system},{"role":"user","content":"Hi"}],
    max_tokens=10,
)
time.sleep(2)

# Call 2 — should report cache hit
r2 = client.chat.completions.create(
    model="cc/claude-haiku-4-5-20251001",
    messages=[{"role":"system","content":big_system},{"role":"user","content":"Hello"}],
    max_tokens=10,
)
assert r2.usage.prompt_tokens_details.cached_tokens > 0, \
    f"Expected cache hit, got {r2.usage.prompt_tokens_details}"
```

---

## Why this matters (for the user, not just my project)

1. **Function calling is the 2026 default for structured output** (LangChain, DSPy, vercel/ai, Pydantic-AI all now route through tools API). Without Bug 1 fixed, n9router users have to fall back to JSON mode + manual parsing on Claude — strictly worse.

2. **Anthropic prompt caching is 5–10× cost reduction** on the cached portion (`$0.30/Mtok cached read` vs `$3/Mtok new` for Sonnet). Without Bug 2 fixed, users can't measure or amortize this even when their prompts are cache-eligible. Effectively half of Anthropic's cost-control surface area is invisible.

Both bugs are localized fixes (~5–15 lines). Happy to PR if helpful.
