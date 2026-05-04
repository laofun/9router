import { NextResponse } from "next/server";
import { getRequestDetailById, saveRequestDetail } from "@/lib/usageDb";

const INTERNAL_REQUEST_HEADER = { name: "x-request-source", value: "local" };
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "id", "provider", "model", "connectionId", "timestamp", "status",
  "latency", "tokens", "request", "providerRequest", "providerResponse", "response",
]);
const ALLOWED_RESPONSE_KEYS = new Set(["content", "thinking", "type", "finish_reason", "finishReason"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function getUnknownKeys(body) {
  return Object.keys(body || {}).filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key));
}

function mergeNumericObjects(existingValue, incomingValue) {
  const next = isPlainObject(existingValue) ? { ...existingValue } : {};
  if (!isPlainObject(incomingValue)) return next;
  for (const [key, value] of Object.entries(incomingValue)) {
    if (typeof value === "number" && Number.isFinite(value)) next[key] = value;
  }
  return next;
}

function mergePlainObjects(existingValue, incomingValue) {
  if (!isPlainObject(incomingValue)) return isPlainObject(existingValue) ? existingValue : {};
  return {
    ...(isPlainObject(existingValue) ? existingValue : {}),
    ...incomingValue,
  };
}

function mergeResponse(existingValue, incomingValue) {
  const next = isPlainObject(existingValue) ? { ...existingValue } : {};
  if (!isPlainObject(incomingValue)) return next;
  for (const [key, value] of Object.entries(incomingValue)) {
    if (ALLOWED_RESPONSE_KEYS.has(key)) next[key] = value;
  }
  return next;
}

function mergeProviderResponse(existingValue, incomingValue) {
  if (typeof incomingValue === "string") return incomingValue;
  if (isPlainObject(incomingValue)) return incomingValue;
  return incomingValue === undefined ? existingValue : existingValue ?? null;
}

function buildDetail(existing, body) {
  if (!existing) return body;
  return {
    ...existing,
    ...body,
    latency: mergeNumericObjects(existing.latency, body.latency),
    tokens: mergeNumericObjects(existing.tokens, body.tokens),
    request: mergePlainObjects(existing.request, body.request),
    providerRequest: mergePlainObjects(existing.providerRequest, body.providerRequest),
    providerResponse: mergeProviderResponse(existing.providerResponse, body.providerResponse),
    response: mergeResponse(existing.response, body.response),
  };
}

export async function POST(request) {
  if (request.headers.get(INTERNAL_REQUEST_HEADER.name) !== INTERNAL_REQUEST_HEADER.value) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    if (!body?.id || typeof body.id !== "string") {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }

    const unknownKeys = getUnknownKeys(body);
    if (unknownKeys.length > 0) {
      return NextResponse.json({ error: `unknown fields: ${unknownKeys.join(",")}` }, { status: 400 });
    }

    const existing = await getRequestDetailById(body.id);
    const detail = buildDetail(existing, body);

    await saveRequestDetail(detail);
    return NextResponse.json({ ok: true, id: detail.id });
  } catch (error) {
    return NextResponse.json({ error: error.message || "failed to persist request detail" }, { status: 500 });
  }
}
