import { getUsageStats, statsEmitter, getActiveRequests } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

const REFRESH_DELAY_MS = 200;

function cleanupState(state) {
  state.closed = true;
  statsEmitter.off("update", state.scheduleRefresh);
  statsEmitter.off("pending", state.sendPending);
  clearInterval(state.keepalive);
  clearTimeout(state.refreshTimer);
  state.refreshTimer = null;
}

export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, refreshTimer: null, send: null, sendPending: null, scheduleRefresh: null, cachedStats: null };

  const stream = new ReadableStream({
    async start(controller) {
      state.send = async () => {
        if (state.closed) return;
        try {
          if (state.cachedStats) {
            const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
            const quickStats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
          }
          const stats = await getUsageStats();
          state.cachedStats = stats;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          cleanupState(state);
        }
      };

      state.scheduleRefresh = () => {
        if (state.closed || state.refreshTimer) return;
        state.refreshTimer = setTimeout(async () => {
          state.refreshTimer = null;
          await state.send();
        }, REFRESH_DELAY_MS);
      };

      state.sendPending = async () => {
        if (state.closed || !state.cachedStats) return;
        try {
          const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
          const stats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          cleanupState(state);
        }
      };

      await state.send();

      statsEmitter.on("update", state.scheduleRefresh);
      statsEmitter.on("pending", state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanupState(state);
        }
      }, 25000);
    },

    cancel() {
      cleanupState(state);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
