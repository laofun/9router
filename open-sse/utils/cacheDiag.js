import { createHash } from "crypto";

/**
 * Diagnostic logging for Anthropic prompt-cache miss investigation.
 *
 * Enable by setting CACHE_DIAG=1 in the environment. When disabled, all
 * functions are no-ops with negligible overhead. Intended to be removed
 * once the cache-miss root cause is identified.
 *
 * Logs:
 *   [CACHE-DIAG req]   outgoing system blocks summary + key headers
 *   [CACHE-DIAG usage] raw Anthropic usage object (per call / per SSE event)
 */

const enabled = () => process.env.CACHE_DIAG === "1";

/** Truncate auth values so logs are safe to share. */
function redactHeaders(headers) {
  if (!headers) return null;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === "authorization" || lk === "x-api-key") {
      out[k] = typeof v === "string" ? `${v.slice(0, 12)}…(${v.length})` : "[redacted]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Summarize system blocks: type, length, first 50 chars, cache_control presence + ttl. */
function summarizeSystem(system) {
  if (!Array.isArray(system)) {
    if (typeof system === "string") return [{ type: "string", text_len: system.length, text_first_50: system.slice(0, 50) }];
    return system;
  }
  return system.map(b => ({
    type: b?.type,
    text_len: b?.text?.length,
    text_first_50: typeof b?.text === "string" ? b.text.slice(0, 50) : undefined,
    has_cc: !!b?.cache_control,
    cc_ttl: b?.cache_control?.ttl,
  }));
}

/** Log outgoing request shape (Anthropic-bound). Call once per request. */
export function logRequest({ provider, url, headers, body }) {
  if (!enabled()) return;
  if (provider !== "claude") return;
  try {
    // Hash metadata.user_id so we can compare stability across calls without
    // leaking the actual fake device_id / account_uuid values.
    let metadataUserIdHash = null;
    if (typeof body?.metadata?.user_id === "string") {
      metadataUserIdHash = createHash("sha256")
        .update(body.metadata.user_id).digest("hex").slice(0, 12);
    }

    const summary = {
      url,
      headers: redactHeaders({
        "anthropic-beta": headers?.["anthropic-beta"] || headers?.["Anthropic-Beta"],
        "anthropic-version": headers?.["anthropic-version"] || headers?.["Anthropic-Version"],
        "x-api-key": headers?.["x-api-key"],
        "Authorization": headers?.["Authorization"],
      }),
      system: summarizeSystem(body?.system),
      model: body?.model,
      tools_count: Array.isArray(body?.tools) ? body.tools.length : 0,
      messages_count: Array.isArray(body?.messages) ? body.messages.length : 0,
      metadata_user_id_hash: metadataUserIdHash,
    };
    console.log("[CACHE-DIAG req]", JSON.stringify(summary));
  } catch (e) {
    console.log("[CACHE-DIAG req] log error:", e?.message);
  }
}

/**
 * Log a raw Anthropic `usage` object. `label` distinguishes call sites
 * (e.g. "non-streaming", "message_start", "message_delta").
 */
export function logUsage(label, usage, extra = null) {
  if (!enabled()) return;
  if (!usage) return;
  try {
    const payload = {
      label,
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
      },
    };
    if (extra) payload.extra = extra;
    console.log("[CACHE-DIAG usage]", JSON.stringify(payload));
  } catch (e) {
    console.log("[CACHE-DIAG usage] log error:", e?.message);
  }
}
