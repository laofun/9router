import { NextResponse } from "next/server";
import { disableTunnel } from "@/lib/tunnel/tunnelManager";
import { requireAdminSession } from "@/lib/serverAuth";

export async function POST() {
  const unauthorized = await requireAdminSession();
  if (unauthorized) return unauthorized;

  try {
    const result = await disableTunnel();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel disable error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
