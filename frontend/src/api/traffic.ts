import { fetchJson } from "./client";
import type { HistoryItem, Period, RealtimePoint, Summary, SystemStatus } from "../types";

export function getDashboardSummary(): Promise<Summary> {
  return fetchJson<Summary>("/api/dashboard/summary");
}

export function getRealtimeTraffic(limit = 300): Promise<RealtimePoint[]> {
  return fetchJson<RealtimePoint[]>(`/api/traffic/realtime?limit=${limit}`);
}

export function getTrafficHistory(period: Period, limit?: number): Promise<HistoryItem[]> {
  const params = new URLSearchParams({ period });
  if (limit) {
    params.set("limit", String(limit));
  }
  return fetchJson<HistoryItem[]>(`/api/traffic/history?${params.toString()}`);
}

export function getSystemStatus(): Promise<SystemStatus> {
  return fetchJson<SystemStatus>("/api/system/status");
}
