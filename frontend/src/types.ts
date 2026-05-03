export type BackendState = "checking" | "online" | "offline";
export type RoutePath = "/" | "/history";
export type Period = "day" | "week" | "month" | "year";
export type ScaleMode = "actual" | "log" | "percent";
export type HistoryView = "list" | "calendar";
export type ThemeMode = "light" | "dark";
export type CollectorStatus = "online" | "stale" | "no_data";

export type Summary = {
  today_download: number;
  today_upload: number;
  today_total: number;
  month_download: number;
  month_upload: number;
  month_total: number;
  current_download_speed: number;
  current_upload_speed: number;
  latest_record_time: string | null;
};

export type RealtimePoint = {
  time: string;
  download_speed: number;
  upload_speed: number;
};

export type HistoryItem = {
  label: string;
  start_time: string;
  end_time: string;
  download_bytes: number;
  upload_bytes: number;
  total_bytes: number;
};

export type CalendarDay = {
  key: string;
  date: Date;
  item: HistoryItem | null;
  inRange: boolean;
};

export type SystemStatus = {
  backend_status: "ok";
  database_status: "connected" | "disconnected";
  collector_status: CollectorStatus;
  configured_interface: string;
  latest_interface: string | null;
  latest_record_time: string | null;
  seconds_since_last_record: number | null;
  total_records: number;
  available_interfaces: string[];
  monitored_interfaces: string[];
  collect_interval: number;
  error?: string;
};
