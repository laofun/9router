import { NextResponse } from "next/server";
import { enableTunnel } from "@/lib/tunnel/tunnelManager";
import { requireAdminSession } from "@/lib/serverAuth";

const DNS_WARMUP_DELAY_MS = 8000;

export async function POST() {
  const unauthorized = await requireAdminSession();
  if (unauthorized) return unauthorized;

  try {
    const result = await enableTunnel();
    // Wait for DNS warmup to propagate at Cloudflare edge after tunnel registered
    await new Promise((r) => setTimeout(r, DNS_WARMUP_DELAY_MS));
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel enable error:", error);
    const status = error.message?.includes("Tunnel is disabled") ? 403 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
