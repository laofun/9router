import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_API_PATH_PREFIXES = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/settings/require-login",
  "/api/version",
  "/api/locale",
  "/api/init",
  "/api/v1",
  "/api/v1beta",
  "/api/cloud/auth",
  "/api/cloud/model/resolve",
  "/api/cloud/models/alias",
  "/api/cloud/credentials/update",
];

// Always require a valid JWT regardless of requireLogin setting.
const ALWAYS_PROTECTED_API_PATHS = [
  "/api/shutdown",
  "/api/settings/database",
  "/api/providers/client",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/9remote",
  "/api/tunnel",
];

function getSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

function misconfiguredResponse() {
  return NextResponse.json(
    { error: "JWT_SECRET is required for authenticated admin routes" },
    { status: 503 }
  );
}

function isPublicApiPath(pathname) {
  return PUBLIC_API_PATH_PREFIXES.some((prefix) => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  ));
}

async function hasValidToken(request) {
  const secret = getSecret();
  if (!secret) return false;

  const token = request.cookies.get("auth_token")?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

async function isAuthenticated(request) {
  if (await hasValidToken(request)) return true;
  // Allow if requireLogin is disabled
  const origin = request.nextUrl.origin;
  try {
    const res = await fetch(`${origin}/api/settings/require-login`);
    const data = await res.json();
    if (data.requireLogin === false) return true;
  } catch {
    // On error, require login
  }
  return false;
}

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (isPublicApiPath(pathname)) {
      return NextResponse.next();
    }

    if (ALWAYS_PROTECTED_API_PATHS.some((p) => pathname.startsWith(p))) {
      if (!getSecret()) {
        return misconfiguredResponse();
      }

      if (await hasValidToken(request)) {
        return NextResponse.next();
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (await isAuthenticated(request)) {
      return NextResponse.next();
    }

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Protect all dashboard routes
  if (pathname.startsWith("/dashboard")) {
    const token = request.cookies.get("auth_token")?.value;
    const secret = getSecret();

    if (token && secret) {
      try {
        await jwtVerify(token, secret);
        return NextResponse.next();
      } catch {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    const origin = request.nextUrl.origin;
    try {
      const res = await fetch(`${origin}/api/settings/require-login`);
      const data = await res.json();
      if (data.requireLogin === false) {
        return NextResponse.next();
      }
    } catch {
      // On error, require login
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect / to /dashboard if logged in, or /dashboard if it's the root
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}
