import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import * as echarts from "echarts/core";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { BarChart, LineChart } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";
import { useCurrentSpeed, useDashboardSummary, useRealtimeTraffic, useSystemStatus, useTrafficHistory } from "./hooks/useTrafficData";
import type { BackendState, CalendarDay, HistoryItem, HistoryView, Period, RealtimePoint, RoutePath, ScaleMode, Summary, SystemStatus, ThemeMode } from "./types";
import { formatBytes, formatDateTime, formatSpeed } from "./utils/format";
import "./styles.css";

echarts.use([GridComponent, LegendComponent, TooltipComponent, BarChart, LineChart, CanvasRenderer]);
const themeStorageKey = "nas-netstats-theme";

const periodOptions: Array<{ value: Period; label: string }> = [
  { value: "day", label: "日视图" },
  { value: "week", label: "周视图" },
  { value: "month", label: "月视图" },
  { value: "year", label: "年视图" }
];

const compactPeriodOptions: Array<{ value: Period; label: string }> = [
  { value: "day", label: "日" },
  { value: "week", label: "周" },
  { value: "month", label: "月" },
  { value: "year", label: "年" }
];

const scaleOptions: Array<{ value: ScaleMode; label: string }> = [
  { value: "actual", label: "实际比例" },
  { value: "log", label: "对数比例" },
  { value: "percent", label: "百分比比例" }
];

const weekDayLabels = ["一", "二", "三", "四", "五", "六", "日"];
const monthLabels = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function bindChartResize(chart: ReturnType<typeof echarts.init>, element: HTMLElement): () => void {
  let frame = 0;
  const resize = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => chart.resize());
  };
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);

  observer?.observe(element);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", resize);
  resize();

  return () => {
    window.cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", resize);
  };
}

function splitMetricValue(value: string): { number: string; unit: string } | null {
  const match = value.match(/^(.+?)\s([A-Z]+(?:\/s)?)$/);
  if (!match) {
    return null;
  }

  return {
    number: match[1],
    unit: match[2]
  };
}

function getInitialTheme(): ThemeMode {
  try {
    return localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function currentRoute(): RoutePath {
  return window.location.pathname === "/history" ? "/history" : "/";
}

function newestDate(...dates: Array<Date | null>): Date | null {
  const timestamps = dates.map((date) => date?.getTime() ?? 0).filter((time) => time > 0);
  if (timestamps.length === 0) {
    return null;
  }
  return new Date(Math.max(...timestamps));
}

function StatusBadge({ state }: { state: BackendState }) {
  const text = {
    checking: "连接中",
    online: "已连接",
    offline: "后端连接失败"
  }[state];

  return (
    <div className={`status-badge ${state}`}>
      <span />
      {text}
    </div>
  );
}

function collectorStatusText(status: SystemStatus["collector_status"]): string {
  if (status === "online") {
    return "采集正常";
  }
  if (status === "stale") {
    return "采集延迟";
  }
  return "暂无采集数据";
}

function collectorStatusTone(status: SystemStatus["collector_status"]): "online" | "stale" | "no-data" {
  if (status === "online") {
    return "online";
  }
  if (status === "stale") {
    return "stale";
  }
  return "no-data";
}

function isAllInterfacesMode(interfaceName: string): boolean {
  const value = interfaceName.trim().toLowerCase();
  return value === "all" || value === "*" || value === "全部" || value === "所有";
}

function displayInterfaceName(interfaceName: string): string {
  return isAllInterfacesMode(interfaceName) ? "所有 NAS 网卡" : interfaceName || "-";
}

function interfaceMismatch(status: SystemStatus): boolean {
  if (isAllInterfacesMode(status.configured_interface)) {
    return false;
  }
  return status.available_interfaces.length > 0 && !status.available_interfaces.includes(status.configured_interface);
}

function DiagnosticsTips({ status, compact = false }: { status: SystemStatus; compact?: boolean }) {
  const mismatch = interfaceMismatch(status);

  return (
    <div className={`diagnostics-tips ${compact ? "compact" : ""}`}>
      <strong>排查建议</strong>
      <ul>
        <li>检查 NAS_INTERFACE 是否填写正确。</li>
        <li>检查 collector 是否正在运行。</li>
        <li>检查 /host/proc/net/dev 是否挂载成功。</li>
        <li>检查 BACKEND_API 是否正确。</li>
        <li>检查当前可用网卡是否包含配置的网卡。</li>
      </ul>
      <div className="diagnostics-interfaces">
        <span>当前监控网卡：{displayInterfaceName(status.configured_interface)}</span>
        <span>实际监控：{status.monitored_interfaces.length > 0 ? status.monitored_interfaces.join(" / ") : "暂无心跳上报"}</span>
        <span>可用网卡：{status.available_interfaces.length > 0 ? status.available_interfaces.join(" / ") : "暂无心跳上报"}</span>
      </div>
      {mismatch ? (
        <div className="interface-warning">
          当前配置网卡 {status.configured_interface} 未在系统网卡列表中发现，请检查 NAS_INTERFACE。
        </div>
      ) : null}
    </div>
  );
}

function DiagnosticsCollapsible({ status }: { status: SystemStatus }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
      <div className="diagnostics-short">
        <i className="diagnostics-short-icon" />
        <span>暂无数据，请检查采集器状态。</span>
        <button
          type="button"
          className="diagnostics-collapse-btn"
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`arrow ${open ? "open" : ""}`}>▶</span>
          {open ? "收起排查建议" : "查看排查建议"}
        </button>
      </div>
      {open ? <DiagnosticsTips status={status} compact /> : null}
    </div>
  );
}

function SystemStatusBar({ status, error }: { status: SystemStatus; error: string | null }) {
  const [tipsOpen, setTipsOpen] = useState(false);
  const mismatch = interfaceMismatch(status);
  const dbTone = status.database_status === "connected" ? "success" : "danger";
  const collectorTone = collectorStatusTone(status.collector_status);
  const backendTone = error ? "danger" : "success";
  const ifaceTone = mismatch ? "danger" : "";

  return (
    <div className="system-status-bar">
      <span className="status-chip">
        <span className={`status-chip-dot ${backendTone}`} />
        <span className="status-chip-label">后端</span>
        <span className={`status-chip-value ${backendTone}`}>{error ? "异常" : "正常"}</span>
      </span>
      <span className="status-chip-divider">|</span>
      <span className="status-chip">
        <span className={`status-chip-dot ${dbTone}`} />
        <span className="status-chip-label">数据库</span>
        <span className={`status-chip-value ${dbTone}`}>
          {status.database_status === "connected" ? "已连接" : "失败"}
        </span>
      </span>
      <span className="status-chip-divider">|</span>
      <span className="status-chip">
        <span className={`status-chip-dot ${collectorTone === "stale" ? "warning" : collectorTone}`} />
        <span className="status-chip-label">采集器</span>
        <span className={`status-chip-value ${collectorTone === "stale" ? "warning" : collectorTone}`}>
          {collectorStatusText(status.collector_status)}
        </span>
      </span>
      <span className="status-chip-divider">|</span>
      <span className="status-chip">
        <span className="status-chip-label">网卡</span>
        <span className={`status-chip-value ${ifaceTone}`}>{displayInterfaceName(status.configured_interface)}</span>
      </span>
      <span className="status-chip-divider">|</span>
      <span className="status-chip">
        <span className="status-chip-label">记录</span>
        <span className="status-chip-value">{status.total_records.toLocaleString()}</span>
      </span>
      <span className="status-chip-divider">|</span>
      <span className="status-chip">
        <span className="status-chip-label">最近采集</span>
        <span className="status-chip-value">{formatDateTime(status.latest_record_time)}</span>
      </span>
      <span className="status-extra">
        <button
          type="button"
          className="status-extra-toggle"
          onClick={() => setTipsOpen((v) => !v)}
          title="查看详情"
        >
          {tipsOpen ? "收起" : "详情"}
        </button>
        {tipsOpen ? (
          <div className="status-extra-dropdown">
            <div>最新网卡：{status.latest_interface ? displayInterfaceName(status.latest_interface) : "-"}</div>
            <div>采集间隔：{status.collect_interval}s</div>
            <div>距上次采集：{status.seconds_since_last_record ?? "-"}s</div>
            <div>
              实际监控：{status.monitored_interfaces.length > 0
                ? status.monitored_interfaces.join(" / ")
                : "暂无心跳上报"}
            </div>
            <div>
              可用网卡：{status.available_interfaces.length > 0
                ? status.available_interfaces.join(" / ")
                : "暂无心跳上报"}
            </div>
            {mismatch ? (
              <div style={{ color: "var(--color-warning)", marginTop: 6 }}>
                配置网卡 {status.configured_interface} 未在系统网卡列表中发现。
              </div>
            ) : null}
            <div className="system-tips-collapse">
              <button
                type="button"
                className="status-extra-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  setTipsOpen((v) => !v);
                }}
              >
                排查建议
              </button>
              <div className="system-tips-content">
                <ul>
                  <li>检查 NAS_INTERFACE 是否填写正确。</li>
                  <li>检查 collector 是否正在运行。</li>
                  <li>检查 /host/proc/net/dev 是否挂载成功。</li>
                  <li>检查 BACKEND_API 是否正确。</li>
                  <li>检查当前可用网卡是否包含配置的网卡。</li>
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </span>
    </div>
  );
}


function ThemeToggle({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  const isDark = theme === "dark";

  return (
    <button type="button" className="theme-toggle" aria-pressed={isDark} onClick={onToggle}>
      <span className="theme-toggle-knob" />
      深色模式
    </button>
  );
}

function DashboardHeader({
  backendState,
  latestRecordTime,
  lastRefreshTime,
  theme,
  onToggleTheme
}: {
  backendState: BackendState;
  latestRecordTime: string | null;
  lastRefreshTime: Date | null;
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  return (
    <header className="dashboard-header">
      <div className="dashboard-header-title">
        <h1>NAS NetStats</h1>
        <span className="header-subtitle">NAS TRAFFIC MONITOR</span>
      </div>
      <div className="dashboard-header-actions">
        <span className="header-meta">
          <span>最新</span>
          <strong>{formatDateTime(latestRecordTime)}</strong>
        </span>
        <span className="header-meta-divider">|</span>
        <span className="header-meta">
          <span>刷新</span>
          <strong>{formatDateTime(lastRefreshTime)}</strong>
        </span>
        <StatusBadge state={backendState} />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </header>
  );
}


function Nav({ route, onNavigate }: { route: RoutePath; onNavigate: (path: RoutePath) => void }) {
  return (
    <nav className="nav-tabs" aria-label="页面导航">
      <button className={route === "/" ? "active" : ""} onClick={() => onNavigate("/")}>
        首页
      </button>
      <button className={route === "/history" ? "active" : ""} onClick={() => onNavigate("/history")}>
        历史统计
      </button>
    </nav>
  );
}

function MetricCard({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "download" | "upload" }) {
  const parts = splitMetricValue(value);

  return (
    <section className={`metric-card ${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">
        {parts ? (
          <>
            <span className="metric-number">{parts.number}</span>
            <span className="metric-unit">{parts.unit}</span>
          </>
        ) : (
          value
        )}
      </div>
    </section>
  );
}

function SpeedOverview({ summary }: { summary: Summary }) {
  return (
    <section className="speed-overview">
      <MetricCard label="当前下载速度" value={formatSpeed(summary.current_download_speed)} tone="download" />
      <MetricCard label="当前上传速度" value={formatSpeed(summary.current_upload_speed)} tone="upload" />
    </section>
  );
}

function TrafficStatCards({
  title,
  items
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
}) {
  return (
    <section className="stat-section">
      <div className="section-title">{title}</div>
      <div className="metric-grid">
        {items.map((item) => (
          <MetricCard key={item.label} label={item.label} value={formatBytes(item.value)} />
        ))}
      </div>
    </section>
  );
}

function AlertSummary() {
  return (
    <section className="alert-summary">
      <div>
        <h2>流量阈值提醒摘要</h2>
        <p>当前未配置复杂告警，页面仅展示 NAS 网卡实时采集状态。</p>
      </div>
      <span>正常</span>
    </section>
  );
}

function RealtimeChart({ data, theme, systemStatus }: { data: RealtimePoint[]; theme: ThemeMode; systemStatus: SystemStatus }) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) {
      return;
    }

    const chart = echarts.init(element);
    const isDark = theme === "dark";
    const textColor = cssVar("--color-text", isDark ? "#dbeafe" : "#172033");
    const mutedColor = cssVar("--color-text-muted", isDark ? "#8ea3bc" : "#64748b");
    const gridColor = cssVar("--color-chart-grid", isDark ? "rgba(148, 163, 184, 0.16)" : "rgba(100, 116, 139, 0.18)");
    const axisColor = cssVar("--color-border-strong", isDark ? "rgba(148, 163, 184, 0.34)" : "#cbd5e1");
    const downloadColor = cssVar("--color-download", isDark ? "#38bdf8" : "#0284c7");
    const uploadColor = cssVar("--color-upload", isDark ? "#34d399" : "#10b981");
    const labels = data.map((item) =>
      new Date(item.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })
    );

    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      color: [downloadColor, uploadColor],
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "#111827" : "#ffffff",
        borderColor: isDark ? "#334155" : "#cbd5e1",
        textStyle: {
          color: textColor
        },
        valueFormatter: (value: number) => formatSpeed(value)
      },
      legend: {
        top: 0,
        data: ["下载速度", "上传速度"],
        textStyle: {
          color: textColor
        }
      },
      grid: {
        left: 64,
        right: 24,
        top: 36,
        bottom: 32
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: labels,
        axisLabel: {
          color: mutedColor
        },
        axisLine: {
          lineStyle: {
            color: axisColor
          }
        },
        axisTick: {
          lineStyle: {
            color: axisColor
          }
        }
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: mutedColor,
          formatter: (value: number) => formatSpeed(value)
        },
        splitLine: {
          lineStyle: {
            color: gridColor
          }
        },
        axisLine: {
          lineStyle: {
            color: axisColor
          }
        }
      },
      series: [
        {
          name: "下载速度",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: data.map((item) => item.download_speed)
        },
        {
          name: "上传速度",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: data.map((item) => item.upload_speed)
        }
      ]
    });

    const unbindResize = bindChartResize(chart, element);

    return () => {
      unbindResize();
      chart.dispose();
    };
  }, [data, theme]);

  return (
    <div className="chart-wrap">
      <div className="chart" ref={chartRef} />
      {data.length === 0 ? (
        <div className="empty-chart with-diagnostics">
          <span>暂无实时速度数据</span>
          <DiagnosticsTips status={systemStatus} compact />
        </div>
      ) : null}
    </div>
  );
}

function DashboardPage({
  summary,
  realtime,
  error,
  systemStatus,
  systemStatusError,
  theme,
  backendState,
  onToggleTheme,
  lastRefreshTime,
  onOpenHistory
}: {
  summary: Summary;
  realtime: RealtimePoint[];
  error: string | null;
  systemStatus: SystemStatus;
  systemStatusError: string | null;
  theme: ThemeMode;
  backendState: BackendState;
  onToggleTheme: () => void;
  lastRefreshTime: Date | null;
  onOpenHistory: () => void;
}) {
  return (
    <div className="dashboard-shell">
      <section className="dashboard-main">
        <DashboardHeader
          backendState={backendState}
          latestRecordTime={summary.latest_record_time}
          lastRefreshTime={lastRefreshTime}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />
        <SystemStatusBar status={systemStatus} error={systemStatusError} />


        <SpeedOverview summary={summary} />

        <div className="traffic-groups">
          <TrafficStatCards
            title="今日流量"
            items={[
              { label: "今日下载", value: summary.today_download },
              { label: "今日上传", value: summary.today_upload },
              { label: "今日总流量", value: summary.today_total }
            ]}
          />
          <TrafficStatCards
            title="本月流量"
            items={[
              { label: "本月下载", value: summary.month_download },
              { label: "本月上传", value: summary.month_upload },
              { label: "本月总流量", value: summary.month_total }
            ]}
          />
        </div>

        <section className="panel realtime-panel">
          <div className="panel-head">
            <div>
              <h2>实时网速趋势</h2>
              <p>下载速度和上传速度，最近 300 条记录</p>
            </div>
          </div>
          <RealtimeChart data={realtime} theme={theme} systemStatus={systemStatus} />
        </section>

        <AlertSummary />
      </section>

      <HistoryPanel theme={theme} onOpenHistory={onOpenHistory} systemStatus={systemStatus} />
    </div>
  );
}

function barWidthPercent(totalBytes: number, maxTotalBytes: number, scaleMode: ScaleMode): number {
  if (totalBytes <= 0 || maxTotalBytes <= 0) {
    return 0;
  }

  if (scaleMode === "log") {
    return (Math.log10(totalBytes + 1) / Math.log10(maxTotalBytes + 1)) * 100;
  }

  return (totalBytes / maxTotalBytes) * 100;
}

function barColorClass(totalBytes: number, maxTotalBytes: number): string {
  if (totalBytes <= 0 || maxTotalBytes <= 0) {
    return "level-empty";
  }

  const ratio = totalBytes / maxTotalBytes;
  if (ratio <= 0.1) {
    return "level-blue";
  }
  if (ratio <= 0.3) {
    return "level-green";
  }
  if (ratio <= 0.6) {
    return "level-yellow";
  }
  if (ratio <= 0.9) {
    return "level-red";
  }
  return "level-dark-red";
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function calendarKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function historyItemKey(item: HistoryItem): string {
  return item.label || item.start_time.slice(0, 10);
}

function buildCalendarDays(items: HistoryItem[]): CalendarDay[] {
  const byDate = new Map(items.map((item) => [historyItemKey(item), item]));
  const today = startOfLocalDay(new Date());
  const rangeStart = addDays(today, -364);
  const leadingDays = (rangeStart.getDay() + 6) % 7;
  const gridStart = addDays(rangeStart, -leadingDays);
  const days: CalendarDay[] = [];

  for (let date = gridStart; date <= today; date = addDays(date, 1)) {
    const key = calendarKey(date);
    days.push({
      key,
      date: new Date(date),
      item: byDate.get(key) ?? null,
      inRange: date >= rangeStart,
    });
  }

  return days;
}

function buildCalendarMonthMarkers(days: CalendarDay[]): Array<{ label: string; week: number }> {
  const markers: Array<{ label: string; week: number }> = [];
  let previousMonth = -1;

  days.forEach((day, index) => {
    const week = Math.floor(index / 7) + 1;
    if (!day.inRange) {
      return;
    }
    const month = day.date.getMonth();
    if (month !== previousMonth) {
      markers.push({ label: monthLabels[month], week });
      previousMonth = month;
    }
  });

  return markers;
}

function heatmapLevelClass(item: HistoryItem | null, maxTotalBytes: number): string {
  if (!item) {
    return "heatmap-empty";
  }
  if (maxTotalBytes <= 0) {
    return "heatmap-low";
  }

  const ratio = item.total_bytes / maxTotalBytes;
  if (ratio <= 0.1) {
    return "heatmap-low";
  }
  if (ratio <= 0.35) {
    return "heatmap-medium";
  }
  if (ratio <= 0.6) {
    return "heatmap-raised";
  }
  if (ratio <= 0.85) {
    return "heatmap-high";
  }
  return "heatmap-extreme";
}

function CalendarHeatmap({
  items,
  loading,
  error,
  systemStatus,
}: {
  items: HistoryItem[];
  loading: boolean;
  error: string | null;
  systemStatus: SystemStatus;
}) {
  const days = buildCalendarDays(items);
  const maxTotalBytes = items.reduce((max, item) => Math.max(max, item.total_bytes), 0);
  const weekCount = Math.ceil(days.length / 7);
  const markers = buildCalendarMonthMarkers(days);
  const hasData = items.length > 0;

  return (
    <div className="calendar-view">
      {error ? <div className="error-banner history-error">{error}</div> : null}
      {!loading && !error && !hasData ? (
        <div className="calendar-empty">
          <span>暂无日历热力图数据</span>
          <DiagnosticsTips status={systemStatus} compact />
        </div>
      ) : null}

      <div className="calendar-scroll">
        <div className="calendar-months" style={{ gridTemplateColumns: `repeat(${weekCount}, 14px)` }}>
          {markers.map((marker) => (
            <span key={`${marker.label}-${marker.week}`} style={{ gridColumnStart: marker.week }}>
              {marker.label}
            </span>
          ))}
        </div>

        <div className="calendar-body">
          <div className="calendar-weekdays">
            {weekDayLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="calendar-grid" style={{ gridTemplateColumns: `repeat(${weekCount}, 14px)` }}>
            {days.map((day) => {
              const item = day.item;
              const title = item
                ? `${day.key}\n上传：${formatBytes(item.upload_bytes)}\n下载：${formatBytes(item.download_bytes)}\n总流量：${formatBytes(item.total_bytes)}`
                : `${day.key}\n暂无数据`;

              return (
                <div
                  key={day.key}
                  className={`calendar-cell ${day.inRange ? "" : "outside-range"} ${heatmapLevelClass(item, maxTotalBytes)}`}
                  title={title}
                  aria-label={title}
                >
                  <div className="heatmap-tooltip">
                    <strong>{day.key}</strong>
                    <span>上传：{item ? formatBytes(item.upload_bytes) : "暂无数据"}</span>
                    <span>下载：{item ? formatBytes(item.download_bytes) : "暂无数据"}</span>
                    <span>总流量：{item ? formatBytes(item.total_bytes) : "暂无数据"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="heatmap-footer">
          {loading ? <span className="calendar-loading">正在加载日历热力图数据</span> : <span>最近 365 天总流量</span>}
          <div className="heatmap-legend" aria-label="热力图颜色图例">
            <span>少</span>
            <i className="heatmap-empty" />
            <i className="heatmap-low" />
            <i className="heatmap-medium" />
            <i className="heatmap-raised" />
            <i className="heatmap-high" />
            <i className="heatmap-extreme" />
            <span>多</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function historyRecordKey(item: HistoryItem): string {
  return `${item.label}-${item.start_time}`;
}

function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportHistoryCsv(items: HistoryItem[], period: Period) {
  const headers = ["日期", "开始时间", "结束时间", "上传", "下载", "总流量"];
  const rows = items.map((item) => [
    item.label,
    item.start_time,
    item.end_time,
    item.upload_bytes,
    item.download_bytes,
    item.total_bytes
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `nas-netstats-history-${period}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function HistoryList({
  items,
  loading,
  selectedKey,
  onSelect,
  systemStatus
}: {
  items: HistoryItem[];
  loading: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  systemStatus: SystemStatus;
}) {
  const visibleItems = items.slice(0, 12);

  return (
    <div className="dashboard-history-list">
      {visibleItems.map((item) => {
        const key = historyRecordKey(item);
        return (
          <button
            type="button"
            key={key}
            className={`history-list-row ${selectedKey === key ? "active" : ""}`}
            onClick={() => onSelect(key)}
          >
            <div className="history-list-main">
              <strong>{item.label}</strong>
              <span>上传 {formatBytes(item.upload_bytes)} · 下载 {formatBytes(item.download_bytes)}</span>
            </div>
            <div className="history-row-total">{formatBytes(item.total_bytes)}</div>
          </button>
        );
      })}
      {!loading && items.length === 0 ? (
        <div className="compact-empty">
          <DiagnosticsCollapsible status={systemStatus} />
        </div>
      ) : null}
      {loading ? <div className="compact-empty">正在加载历史统计</div> : null}
    </div>
  );
}

function HistoryChart({
  items,
  theme,
  selectedKey,
  systemStatus,
  variant = "mini",
  limit = 12
}: {
  items: HistoryItem[];
  theme: ThemeMode;
  selectedKey: string | null;
  systemStatus?: SystemStatus;
  variant?: "mini" | "full";
  limit?: number;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) {
      return;
    }

    const chart = echarts.init(element);
    const isDark = theme === "dark";
    const chartItems = items.slice(0, limit).reverse();
    const textColor = cssVar("--color-text", isDark ? "#dbeafe" : "#172033");
    const gridColor = cssVar("--color-chart-grid", isDark ? "rgba(148, 163, 184, 0.16)" : "rgba(100, 116, 139, 0.18)");
    const downloadColor = cssVar("--color-download", isDark ? "#38bdf8" : "#0284c7");
    const uploadColor = cssVar("--color-upload", isDark ? "#34d399" : "#10b981");
    const mutedColor = cssVar("--color-text-muted", isDark ? "#8ea3bc" : "#66758a");

    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      color: [downloadColor],
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow"
        },
        backgroundColor: isDark ? "#111827" : "#ffffff",
        borderColor: isDark ? "#334155" : "#cbd5e1",
        textStyle: {
          color: textColor
        },
        formatter: (params: unknown) => {
          const param = Array.isArray(params) ? params[0] : params;
          const dataIndex = typeof param === "object" && param && "dataIndex" in param ? Number((param as { dataIndex: number }).dataIndex) : 0;
          const item = chartItems[dataIndex];
          if (!item) {
            return "";
          }

          return [
            `<strong>${item.label}</strong>`,
            `上传：${formatBytes(item.upload_bytes)}`,
            `下载：${formatBytes(item.download_bytes)}`,
            `总流量：${formatBytes(item.total_bytes)}`
          ].join("<br/>");
        }
      },
      grid: {
        left: 76,
        right: 16,
        top: 10,
        bottom: 26
      },
      xAxis: {
        type: "value",
        axisLabel: {
          color: textColor,
          formatter: (value: number) => formatBytes(value)
        },
        splitLine: {
          lineStyle: {
            color: gridColor
          }
        }
      },
      yAxis: {
        type: "category",
        data: chartItems.map((item) => item.label),
        axisLabel: {
          color: textColor,
          width: 66,
          overflow: "truncate"
        }
      },
      series: [
        {
          name: "总流量",
          type: "bar",
          barWidth: 11,
          itemStyle: {
            borderRadius: [0, 4, 4, 0]
          },
          data: chartItems.map((item) => {
            const key = historyRecordKey(item);
            return {
              value: item.total_bytes,
              itemStyle: {
                color: key === selectedKey ? uploadColor : downloadColor,
                opacity: selectedKey && key !== selectedKey ? 0.62 : 1
              },
              label: {
                show: false,
                color: mutedColor
              }
            };
          })
        }
      ]
    });

    const unbindResize = bindChartResize(chart, element);

    return () => {
      unbindResize();
      chart.dispose();
    };
  }, [items, limit, selectedKey, theme]);

  return (
    <div className={`history-chart-wrap ${variant === "full" ? "full-history-chart-wrap" : ""}`}>
      <div className="history-chart" ref={chartRef} />
      {items.length === 0 ? (
        <div className="empty-chart with-diagnostics">
          <span>暂无历史图表数据</span>
          {systemStatus ? <DiagnosticsTips status={systemStatus} compact /> : null}
        </div>
      ) : null}
    </div>
  );
}

function HistoryPanel({ theme, onOpenHistory, systemStatus }: { theme: ThemeMode; onOpenHistory: () => void; systemStatus: SystemStatus }) {
  const [period, setPeriod] = useState<Period>("week");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { data: items, loading, error } = useTrafficHistory(period, 30);
  const maxTotalBytes = items.reduce((max, item) => Math.max(max, item.total_bytes), 0);
  const totalBytes = items.reduce((sum, item) => sum + item.total_bytes, 0);

  useEffect(() => {
    if (items.length === 0) {
      setSelectedKey(null);
      return;
    }

    setSelectedKey((current) => (current && items.some((item) => historyRecordKey(item) === current) ? current : historyRecordKey(items[0])));
  }, [items]);

  return (
    <aside className="dashboard-side">
      <section className="panel history-summary-panel">
        <div className="side-panel-head">
          <div>
            <h2>历史统计</h2>
            <p>按周期查看 NAS 整体流量</p>
          </div>
        </div>

        <div className="period-switch" aria-label="历史统计周期">
          {compactPeriodOptions.map((option) => (
            <button type="button" key={option.value} className={period === option.value ? "active" : ""} onClick={() => setPeriod(option.value)}>
              {option.label}
            </button>
          ))}
        </div>

        <div className="history-overview">
          <div>
            <span>当前列表总量</span>
            <strong>{formatBytes(totalBytes)}</strong>
          </div>
          <div>
            <span>峰值周期</span>
            <strong>{formatBytes(maxTotalBytes)}</strong>
          </div>
        </div>

        {error ? <div className="error-banner compact-error">{error}</div> : null}

        <section className="side-card history-chart-card">
          <div className="side-card-head">
            <div>
              <h3>历史统计图表</h3>
              <p>最近 {Math.min(items.length, 12)} 条周期总流量趋势</p>
            </div>
          </div>
          <HistoryChart items={items} theme={theme} selectedKey={selectedKey} systemStatus={systemStatus} />
        </section>

        <section className="side-card history-list-card">
          <div className="side-card-head">
            <div>
              <h3>历史统计列表</h3>
              <p>最近 12 条记录</p>
            </div>
          </div>
          <HistoryList items={items} loading={loading} selectedKey={selectedKey} onSelect={setSelectedKey} systemStatus={systemStatus} />
        </section>

        <div className="side-panel-footer">
          <button type="button" className="secondary-action" onClick={() => exportHistoryCsv(items, period)} disabled={items.length === 0}>
            导出 CSV
          </button>
          <button type="button" className="primary-action" onClick={onOpenHistory}>
            查看完整历史
          </button>
        </div>
      </section>
    </aside>
  );
}

function HistoryPage({ theme, systemStatus }: { theme: ThemeMode; systemStatus: SystemStatus }) {
  const [view, setView] = useState<HistoryView>("list");
  const [period, setPeriod] = useState<Period>("week");
  const [scaleMode, setScaleMode] = useState<ScaleMode>("actual");
  const { data: items, loading, error } = useTrafficHistory(period, 100, view === "list");
  const { data: calendarItems, loading: calendarLoading, error: calendarError } = useTrafficHistory("day", 365, view === "calendar");

  const maxTotalBytes = items.reduce((max, item) => Math.max(max, item.total_bytes), 0);

  return (
    <section className="panel history-panel">
      <div className="history-view-tabs" role="tablist" aria-label="历史统计视图">
        <button type="button" role="tab" aria-selected={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
          列表视图
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "calendar"}
          className={view === "calendar" ? "active" : ""}
          onClick={() => setView("calendar")}
        >
          日历视图
        </button>
      </div>

      {view === "calendar" ? (
        <CalendarHeatmap items={calendarItems} loading={calendarLoading} error={calendarError} systemStatus={systemStatus} />
      ) : (
        <>
          <div className="history-toolbar">
            <div className="control-group">
              <label htmlFor="period-select">统计方式</label>
              <select id="period-select" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
                {periodOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="control-group">
              <label htmlFor="scale-select">图表显示比例</label>
              <select id="scale-select" value={scaleMode} onChange={(event) => setScaleMode(event.target.value as ScaleMode)}>
                {scaleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <button type="button" className="toolbar-action" onClick={() => exportHistoryCsv(items, period)} disabled={items.length === 0}>
              导出 CSV
            </button>
          </div>

          {error ? <div className="error-banner history-error">{error}</div> : null}

          <section className="full-history-chart-card">
            <div className="full-history-chart-head">
              <div>
                <h2>完整历史图表</h2>
                <p>当前周期最近 {Math.min(items.length, 24)} 条总流量趋势</p>
              </div>
            </div>
            <HistoryChart items={items} theme={theme} selectedKey={null} systemStatus={systemStatus} variant="full" limit={24} />
          </section>

          <div className="history-table-wrap">
            <table className="history-table">
              <colgroup>
                <col className="date-column" />
                <col className="number-column" />
                <col className="number-column" />
                <col className="number-column" />
                <col className="chart-column" />
              </colgroup>
              <thead>
                <tr>
                  <th>日期</th>
                  <th className="numeric-head">上传</th>
                  <th className="numeric-head">下载</th>
                  <th className="numeric-head">总流量</th>
                  <th>图表</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const width = barWidthPercent(item.total_bytes, maxTotalBytes, scaleMode);
                  const ratio = maxTotalBytes > 0 ? (item.total_bytes / maxTotalBytes) * 100 : 0;
                  return (
                    <tr key={`${item.label}-${item.start_time}`}>
                      <td className="date-cell">{item.label}</td>
                      <td className="numeric-cell">{formatBytes(item.upload_bytes)}</td>
                      <td className="numeric-cell">{formatBytes(item.download_bytes)}</td>
                      <td className="numeric-cell total-cell">{formatBytes(item.total_bytes)}</td>
                      <td className="bar-cell">
                        <div className="bar-track">
                          <div className={`traffic-bar ${barColorClass(item.total_bytes, maxTotalBytes)}`} style={{ width: `${width}%` }} />
                        </div>
                        <span className="bar-label">{scaleMode === "percent" ? `${ratio.toFixed(1)}%` : formatBytes(item.total_bytes)}</span>
                      </td>
                    </tr>
                  );
                })}
                {!loading && items.length === 0 ? (
                  <tr>
                    <td className="empty-row" colSpan={5}>
                      <span>暂无历史流量数据</span>
                      <DiagnosticsTips status={systemStatus} compact />
                    </td>
                  </tr>
                ) : null}
                {loading ? (
                  <tr>
                    <td className="empty-row" colSpan={5}>
                      正在加载历史流量数据
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function App() {
  const [route, setRoute] = useState<RoutePath>(currentRoute());
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const summaryQuery = useDashboardSummary();
  const systemStatusQuery = useSystemStatus();
  const isDashboardRoute = route === "/";
  const speedQuery = useCurrentSpeed(isDashboardRoute);
  const realtimeQuery = useRealtimeTraffic(isDashboardRoute);
  const latestSpeedPoint = speedQuery.data ?? realtimeQuery.data[realtimeQuery.data.length - 1] ?? null;
  const displaySummary: Summary = {
    ...summaryQuery.data,
    current_download_speed: latestSpeedPoint?.download_speed ?? summaryQuery.data.current_download_speed,
    current_upload_speed: latestSpeedPoint?.upload_speed ?? summaryQuery.data.current_upload_speed,
    latest_record_time: latestSpeedPoint?.time ?? summaryQuery.data.latest_record_time
  };
  const lastRefreshTime = newestDate(summaryQuery.lastUpdated, speedQuery.lastUpdated, realtimeQuery.lastUpdated, systemStatusQuery.lastUpdated);
  const connectionError = summaryQuery.error ?? realtimeQuery.error ?? speedQuery.error ?? systemStatusQuery.error;
  const systemStatusError = systemStatusQuery.error;
  const hasAnySuccess = Boolean(lastRefreshTime);
  const backendState: BackendState = hasAnySuccess ? (connectionError === "连接异常" ? "offline" : "online") : connectionError ? "offline" : "checking";

  function navigate(path: RoutePath) {
    window.history.pushState({}, "", path);
    setRoute(path);
  }

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Ignore storage failures so the UI can still switch theme.
    }
  }, [theme]);

  useEffect(() => {
    const handlePopState = () => setRoute(currentRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return (
    <main className={`page ${route === "/" ? "dashboard-page" : ""}`}>
      {isDashboardRoute ? (
        <DashboardPage
          summary={displaySummary}
          realtime={realtimeQuery.data}
          error={connectionError}
          systemStatus={systemStatusQuery.data}
          systemStatusError={systemStatusError}
          theme={theme}
          backendState={backendState}
          onToggleTheme={toggleTheme}
          lastRefreshTime={lastRefreshTime}
          onOpenHistory={() => navigate("/history")}
        />
      ) : (
        <>
          <header className="topbar">
            <div>
              <h1>NAS NetStats</h1>
              <p>NAS 实时网速与流量统计</p>
            </div>
            <div className="topbar-actions">
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
              <StatusBadge state={backendState} />
            </div>
          </header>

          <Nav route={route} onNavigate={navigate} />
          <HistoryPage theme={theme} systemStatus={systemStatusQuery.data} />
        </>
      )}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
