import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { getRuntimeDebugSnapshot, getRecentLogs } from "@/lib/usageDb";
import { getRecentRequestDetailSummaries } from "@/lib/requestDetailsDb";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettings();
    const runtimeDebugEnabled = settings.runtimeDebugEnabled === true;
    const enableObservability = settings.enableObservability === true || settings.observabilityEnabled === true;

    if (!runtimeDebugEnabled) {
      return NextResponse.json({
        settings: {
          runtimeDebugEnabled: false,
          enableObservability,
        },
        live: null,
        details: { recent: [] },
        logs: { recent: [] },
      });
    }

    const [live, detailSummaries, recentLogs] = await Promise.all([
      getRuntimeDebugSnapshot(),
      getRecentRequestDetailSummaries(10),
      getRecentLogs(20),
    ]);

    return NextResponse.json({
      settings: {
        runtimeDebugEnabled: true,
        enableObservability,
      },
      live,
      details: {
        recent: detailSummaries,
      },
      logs: {
        recent: recentLogs,
      },
    });
  } catch (error) {
    console.error("[API] Failed to build runtime debug snapshot:", error);
    return NextResponse.json({ error: "Failed to fetch runtime debug snapshot" }, { status: 500 });
  }
}
