import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const JWT_SECRET_ERROR = "JWT_SECRET is required for authenticated admin routes";

export function getJwtSecretOrThrow() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(JWT_SECRET_ERROR);
  }
  return new TextEncoder().encode(secret);
}

export async function verifyAuthToken(token) {
  const secret = getJwtSecretOrThrow();
  await jwtVerify(token, secret);
}

export async function hasAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (!token) {
    return { ok: false, reason: "missing" };
  }

  try {
    await verifyAuthToken(token);
    return { ok: true };
  } catch (error) {
    if (error.message === JWT_SECRET_ERROR) {
      return { ok: false, reason: "misconfigured" };
    }
    return { ok: false, reason: "invalid" };
  }
}

export async function requireAdminSession() {
  const session = await hasAdminSession();
  if (session.ok) return null;

  if (session.reason === "misconfigured") {
    return NextResponse.json({ error: JWT_SECRET_ERROR }, { status: 503 });
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
