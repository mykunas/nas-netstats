import type { Period } from "../types";

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number.isFinite(bytes) ? Math.max(bytes, 0) : 0;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 ? 0 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) {
    return "暂无数据";
  }

  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) {
    return "暂无数据";
  }

  return value.toLocaleString();
}

/**
 * 格式化历史图表 X 轴 / Y 轴标签。
 * 根据周期返回短标签，避免过长文字重叠。
 */
export function formatHistoryAxisLabel(label: string, period: Period): string {
  if (!label) return label;

  try {
    switch (period) {
      case "day": {
        // "2026-05-03" -> "05-03"
        const m = label.match(/^\d{4}-(\d{2})-(\d{2})$/);
        if (m) return `${m[1]}-${m[2]}`;
        return label;
      }
      case "week": {
        // "2026/第19周" -> "第19周" or "W19"
        const m = label.match(/第(\d{1,2})周/);
        if (m) return `第${m[1]}周`;
        // ISO: "2026-W19" -> "W19"
        const iso = label.match(/[Ww](\d{1,2})/);
        if (iso) return `W${iso[1]}`;
        return label;
      }
      case "month": {
        // "2026-05" -> "2026-05" (already short)
        const m = label.match(/(\d{4})[-/](\d{2})/);
        if (m) return `${m[1]}-${m[2]}`;
        return label;
      }
      case "year": {
        // "2026" -> "2026"
        const m = label.match(/(\d{4})/);
        if (m) return m[1];
        return label;
      }
      default:
        return label.length > 8 ? label.slice(0, 8) + "…" : label;
    }
  } catch {
    return label.length > 8 ? label.slice(0, 8) + "…" : label;
  }
}

/**
 * 获取当前周期的中文标题
 */
export function getPeriodTitle(period: Period): string {
  const titles: Record<Period, string> = {
    day: "日",
    week: "周",
    month: "月",
    year: "年",
  };
  return titles[period];
}

/**
 * 根据周期和变体返回适合的数据条数限制
 */
export function getPeriodLimit(period: Period, variant: "mini" | "full" = "mini"): number {
  const limits: Record<Period, { mini: number; full: number }> = {
    day: { mini: 14, full: 30 },
    week: { mini: 12, full: 26 },
    month: { mini: 12, full: 24 },
    year: { mini: 5, full: 10 },
  };
  return limits[period][variant];
}

/**
 * 获取周期描述文案（用于列表标题 / 空状态）
 */
export function getPeriodDescription(period: Period, variant: "mini" | "full" = "mini"): string {
  const descriptions: Record<Period, { mini: string; full: string }> = {
    day: { mini: "最近 14 天记录", full: "最近 30 天记录" },
    week: { mini: "最近 12 周记录", full: "最近 26 周记录" },
    month: { mini: "最近 12 个月记录", full: "最近 24 个月记录" },
    year: { mini: "最近 5 年记录", full: "最近 10 年记录" },
  };
  return descriptions[period][variant];
}

/**
 * 获取周期空状态文案
 */
export function getPeriodEmptyText(period: Period): string {
  const texts: Record<Period, string> = {
    day: "暂无日视图历史数据",
    week: "暂无周视图历史数据",
    month: "暂无月视图历史数据",
    year: "暂无年视图历史数据",
  };
  return texts[period];
}
