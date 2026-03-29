import { NextResponse } from "next/server";
import { isInternetOutputDisabled } from "@/lib/runtimeConfig";

const PRIVATE_HOST_SUFFIXES = [".local", ".internal", ".lan", ".home", ".corp"];

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isLocalHostname(hostname) {
  const value = hostname.trim().toLowerCase();
  if (!value) return false;
  if (value === "localhost" || value === "::1" || value === "[::1]") return true;
  if (value.includes(":") && (value.startsWith("fd") || value.startsWith("fc") || value.startsWith("fe80:"))) {
    return true;
  }
  if (isPrivateIpv4(value)) return true;
  if (!value.includes(".")) return true;
  return PRIVATE_HOST_SUFFIXES.some((suffix) => value.endsWith(suffix));
}

export function isLocalNetworkUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function blockedResponse(operation) {
  return NextResponse.json(
    {
      error: `${operation} is disabled in LAN mode to avoid outbound internet traffic`,
    },
    { status: 403 }
  );
}

export function requireInternetOutput(operation = "This action") {
  if (!isInternetOutputDisabled()) return null;
  return blockedResponse(operation);
}

export function requireInternetOutputForUrl(url, operation = "This action") {
  if (!isInternetOutputDisabled()) return null;
  if (isLocalNetworkUrl(url)) return null;
  return blockedResponse(operation);
}
