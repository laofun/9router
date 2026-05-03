"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";

function JsonBlock({ value }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-bg-subtle p-3 text-xs text-text-muted">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-bg p-3">
      <div className="text-xs uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold text-text">{value}</div>
    </div>
  );
}

export default function RuntimeDebugTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDebug = useCallback(async ({ background = false } = {}) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const res = await fetch("/api/runtime-debug", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch runtime debug snapshot");
      const nextData = await res.json();
      setData(nextData);
    } catch (error) {
      console.error("Failed to fetch runtime debug snapshot:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDebug();
  }, [fetchDebug]);

  useEffect(() => {
    const timer = setInterval(() => {
      fetchDebug({ background: true });
    }, 5000);

    return () => clearInterval(timer);
  }, [fetchDebug]);

  if (loading) {
    return <div className="text-sm text-text-muted">Loading runtime debug snapshot…</div>;
  }

  if (!data) {
    return <div className="text-sm text-text-muted">Failed to load runtime debug snapshot.</div>;
  }

  const runtimeDebugEnabled = data.settings?.runtimeDebugEnabled === true;
  const live = data.live;
  const recentDetails = data.details?.recent || [];
  const recentLogs = data.logs?.recent || [];

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Runtime Debug"
        subtitle="Lightweight live runtime diagnostics for the recent perf fixes"
        action={
          <Button variant="secondary" size="sm" onClick={() => fetchDebug({ background: true })} loading={refreshing}>
            Refresh
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Metric label="Runtime Debug" value={runtimeDebugEnabled ? "Enabled" : "Disabled"} />
          <Metric label="Observability" value={data.settings?.enableObservability ? "Enabled" : "Disabled"} />
          <Metric label="Active Requests" value={live?.activeRequests?.length || 0} />
          <Metric label="Pending Timers" value={live?.pendingTimerCount || 0} />
        </div>
        {!runtimeDebugEnabled && (
          <p className="mt-4 text-sm text-text-muted">
            Enable <code>runtimeDebugEnabled</code> in settings to return live state, recent detail summaries, and request logs.
          </p>
        )}
      </Card>

      {runtimeDebugEnabled && (
        <>
          <Card title="Runtime State" subtitle="Current in-memory request and pending state">
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Metric label="Recent Requests" value={live?.recentRequests?.length || 0} />
              <Metric label="Pending Models" value={Object.keys(live?.pendingByModel || {}).length} />
              <Metric label="Last Error Provider" value={live?.errorProvider || "None"} />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium text-text">Active Requests</div>
                <JsonBlock value={live?.activeRequests || []} />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-text">Pending by Model</div>
                <JsonBlock value={live?.pendingByModel || {}} />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-text">Pending by Account</div>
                <JsonBlock value={live?.pendingByAccount || {}} />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-text">Recent Requests</div>
                <JsonBlock value={live?.recentRequests || []} />
              </div>
            </div>
          </Card>

          <Card title="Recent Diagnostic Requests" subtitle="Compact observability summaries only">
            {!recentDetails.length ? (
              <div className="text-sm text-text-muted">No recent request detail summaries.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-text-muted">
                      <th className="py-2 pr-4">Time</th>
                      <th className="py-2 pr-4">Provider</th>
                      <th className="py-2 pr-4">Model</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Connection</th>
                      <th className="py-2 pr-4">Latency</th>
                      <th className="py-2">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDetails.map((detail) => (
                      <tr key={detail.id} className="border-b border-border/50 align-top">
                        <td className="py-2 pr-4 whitespace-nowrap">{detail.timestamp || "-"}</td>
                        <td className="py-2 pr-4">{detail.provider || "-"}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{detail.model || "-"}</td>
                        <td className="py-2 pr-4">{detail.status || "-"}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{detail.connectionId || "-"}</td>
                        <td className="py-2 pr-4">{detail.latency?.totalMs ?? detail.latency?.durationMs ?? "-"}</td>
                        <td className="py-2 font-mono text-xs">{JSON.stringify(detail.tokens || {})}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Recent Request Logs" subtitle="Short tail of request log lines">
            {!recentLogs.length ? (
              <div className="text-sm text-text-muted">No recent request logs.</div>
            ) : (
              <pre className="overflow-x-auto rounded-lg bg-bg-subtle p-3 text-xs text-text-muted">
                {recentLogs.join("\n")}
              </pre>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
