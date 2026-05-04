import { useCallback } from "react";
import { getDashboardSummary, getRealtimeTraffic, getTrafficHistory, getSystemStatus } from "../api/traffic";
import type { HistoryItem, Period, RealtimePoint, Summary, SystemStatus } from "../types";
import { usePollingQuery } from "./usePollingQuery";

export const emptySummary: Summary = {
  today_download: 0,
  today_upload: 0,
  today_total: 0,
  month_download: 0,
  month_upload: 0,
  month_total: 0,
  current_download_speed: 0,
  current_upload_speed: 0,
  latest_record_time: null
};

const emptyRealtime: RealtimePoint[] = [];
const emptyHistory: HistoryItem[] = [];
export const emptySystemStatus: SystemStatus = {
  backend_status: "ok",
  database_status: "disconnected",
  collector_status: "no_data",
  configured_interface: "auto",
  selected_interface: null,
  latest_interface: null,
  latest_record_time: null,
  seconds_since_last_record: null,
  total_records: 0,
  available_interfaces: [],
  recommended_interfaces: [],
  ignored_interfaces: [],
  monitored_interfaces: [],
  collect_interval: 5
};

export function useDashboardSummary() {
  return usePollingQuery<Summary>(getDashboardSummary, {
    initialData: emptySummary,
    intervalMs: 5000,
    hiddenIntervalMs: 30000
  });
}

export function useCurrentSpeed(enabled = true) {
  const fetcher = useCallback(async () => {
    const points = await getRealtimeTraffic(1);
    return points[0] ?? null;
  }, []);

  return usePollingQuery<RealtimePoint | null>(fetcher, {
    initialData: null,
    intervalMs: 1000,
    hiddenIntervalMs: 5000,
    enabled
  });
}

export function useRealtimeTraffic(enabled = true) {
  return usePollingQuery<RealtimePoint[]>(() => getRealtimeTraffic(300), {
    initialData: emptyRealtime,
    intervalMs: 10000,
    hiddenIntervalMs: 60000,
    enabled
  });
}

export function useTrafficHistory(period: Period, limit = 100, enabled = true) {
  const fetcher = useCallback(() => getTrafficHistory(period, limit), [limit, period]);

  return usePollingQuery<HistoryItem[]>(fetcher, {
    initialData: emptyHistory,
    intervalMs: 30000,
    hiddenIntervalMs: 120000,
    enabled
  });
}

export function useSystemStatus() {
  return usePollingQuery<SystemStatus>(getSystemStatus, {
    initialData: emptySystemStatus,
    intervalMs: 10000,
    hiddenIntervalMs: 30000
  });
}
