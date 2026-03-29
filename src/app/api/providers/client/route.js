import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { requireAdminSession } from "@/lib/serverAuth";

// GET /api/providers/client - List all connections for client (includes sensitive fields for sync)
export async function GET() {
  const unauthorized = await requireAdminSession();
  if (unauthorized) return unauthorized;

  try {
    const connections = await getProviderConnections();
    
    // Include sensitive fields for sync to cloud (only accessible from same origin)
    const clientConnections = connections.map(c => ({
      ...c,
      // Don't hide sensitive fields here since this is for internal sync
    }));

    return NextResponse.json({ connections: clientConnections });
  } catch (error) {
    console.log("Error fetching providers for client:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}
