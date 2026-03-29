import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/serverAuth";

export async function POST() {
  const unauthorized = await requireAdminSession();
  if (unauthorized) return unauthorized;

  const response = NextResponse.json({ success: true, message: "Shutting down..." });

  setTimeout(() => {
    process.exit(0);
  }, 500);

  return response;
}
