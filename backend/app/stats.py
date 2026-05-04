import os
from datetime import datetime, time, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import asc, desc, select
from sqlalchemy.orm import Session

from .models import TrafficRecord

DEFAULT_TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Shanghai")


def app_timezone() -> tzinfo:
    try:
        return ZoneInfo(DEFAULT_TIMEZONE)
    except ZoneInfoNotFoundError:
        return timezone.utc


def serialize_time(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(app_timezone()).replace(tzinfo=None).isoformat(timespec="seconds")


def clamp_delta(last_value: int, first_value: int) -> int:
    return max(last_value - first_value, 0)


def start_of_day(value: datetime) -> datetime:
    return datetime.combine(value.date(), time.min, tzinfo=value.tzinfo)


def start_of_month(value: datetime) -> datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    return value.replace(year=year, month=month)


def local_to_utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc)


def first_and_last_records(
    session: Session,
    start: datetime,
    end: datetime,
    interface_name: str,
) -> tuple[TrafficRecord | None, TrafficRecord | None]:
    start_utc = local_to_utc(start)
    end_utc = local_to_utc(end)
    base_filter = (
        TrafficRecord.interface_name == interface_name,
        TrafficRecord.created_at >= start_utc,
        TrafficRecord.created_at < end_utc,
    )
    first_record = session.scalar(
        select(TrafficRecord)
        .where(*base_filter)
        .order_by(asc(TrafficRecord.created_at), asc(TrafficRecord.id))
        .limit(1)
    )
    last_record = session.scalar(
        select(TrafficRecord)
        .where(*base_filter)
        .order_by(desc(TrafficRecord.created_at), desc(TrafficRecord.id))
        .limit(1)
    )
    return first_record, last_record


def period_totals(first_record: TrafficRecord | None, last_record: TrafficRecord | None) -> dict[str, int]:
    if first_record is None or last_record is None:
        return {"download": 0, "upload": 0, "total": 0}

    download = clamp_delta(last_record.rx_bytes, first_record.rx_bytes)
    upload = clamp_delta(last_record.tx_bytes, first_record.tx_bytes)
    return {"download": download, "upload": upload, "total": download + upload}


def dashboard_summary(session: Session, interface_name: str | None) -> dict:
    if not interface_name:
        return {
            "today_download": 0,
            "today_upload": 0,
            "today_total": 0,
            "month_download": 0,
            "month_upload": 0,
            "month_total": 0,
            "current_download_speed": 0,
            "current_upload_speed": 0,
            "latest_record_time": None,
        }

    now = datetime.now(app_timezone())
    today_start = start_of_day(now)
    today_end = today_start + timedelta(days=1)
    month_start = start_of_month(now)
    month_end = add_months(month_start, 1)

    today = period_totals(*first_and_last_records(session, today_start, today_end, interface_name))
    month = period_totals(*first_and_last_records(session, month_start, month_end, interface_name))
    latest_record = session.scalar(
        select(TrafficRecord)
        .where(TrafficRecord.interface_name == interface_name)
        .order_by(desc(TrafficRecord.created_at), desc(TrafficRecord.id))
        .limit(1)
    )

    return {
        "today_download": today["download"],
        "today_upload": today["upload"],
        "today_total": today["total"],
        "month_download": month["download"],
        "month_upload": month["upload"],
        "month_total": month["total"],
        "current_download_speed": latest_record.download_speed if latest_record else 0,
        "current_upload_speed": latest_record.upload_speed if latest_record else 0,
        "latest_record_time": serialize_time(latest_record.created_at if latest_record else None),
    }


def realtime_records(session: Session, limit: int, interface_name: str | None) -> list[dict]:
    if not interface_name:
        return []

    safe_limit = min(max(limit, 1), 2000)
    records = session.scalars(
        select(TrafficRecord)
        .where(TrafficRecord.interface_name == interface_name)
        .order_by(desc(TrafficRecord.created_at), desc(TrafficRecord.id))
        .limit(safe_limit)
    ).all()
    return [
        {
            "time": serialize_time(record.created_at),
            "download_speed": record.download_speed,
            "upload_speed": record.upload_speed,
        }
        for record in reversed(records)
    ]


def period_start(value: datetime, period: str) -> datetime:
    if period == "day":
        return start_of_day(value)
    if period == "week":
        day_start = start_of_day(value)
        return day_start - timedelta(days=day_start.isoweekday() - 1)
    if period == "month":
        return start_of_month(value)
    if period == "year":
        return value.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    raise ValueError(f"Unsupported period: {period}")


def next_period_start(value: datetime, period: str) -> datetime:
    if period == "day":
        return value + timedelta(days=1)
    if period == "week":
        return value + timedelta(weeks=1)
    if period == "month":
        return add_months(value, 1)
    if period == "year":
        return value.replace(year=value.year + 1)
    raise ValueError(f"Unsupported period: {period}")


def history_start(period: str, now: datetime, limit: int) -> datetime:
    current_start = period_start(now, period)
    offset = max(limit - 1, 0)
    if period == "day":
        return current_start - timedelta(days=offset)
    if period == "week":
        return current_start - timedelta(weeks=offset)
    if period == "month":
        return add_months(current_start, -offset)
    if period == "year":
        return current_start.replace(year=current_start.year - offset)
    raise ValueError(f"Unsupported period: {period}")


def period_label(start: datetime, period: str) -> str:
    if period == "day":
        return start.strftime("%Y-%m-%d")
    if period == "week":
        iso_year, iso_week, _ = start.isocalendar()
        return f"{iso_year}/第{iso_week:02d}周"
    if period == "month":
        return start.strftime("%Y-%m")
    if period == "year":
        return start.strftime("%Y")
    raise ValueError(f"Unsupported period: {period}")


def traffic_history(session: Session, period: str, limit: int = 100, interface_name: str | None = None) -> list[dict]:
    if not interface_name:
        return []

    safe_limit = min(max(limit, 1), 1000)
    now = datetime.now(app_timezone())
    start = history_start(period, now, safe_limit)
    records = session.scalars(
        select(TrafficRecord)
        .where(
            TrafficRecord.interface_name == interface_name,
            TrafficRecord.created_at >= local_to_utc(start),
        )
        .order_by(asc(TrafficRecord.created_at), asc(TrafficRecord.id))
    ).all()

    grouped: dict[datetime, list[TrafficRecord]] = {}
    for record in records:
        key = period_start(record.created_at.astimezone(app_timezone()), period)
        grouped.setdefault(key, []).append(record)

    items = []
    for key, period_records in grouped.items():
        first_record = period_records[0]
        last_record = period_records[-1]
        download = clamp_delta(last_record.rx_bytes, first_record.rx_bytes)
        upload = clamp_delta(last_record.tx_bytes, first_record.tx_bytes)
        end = next_period_start(key, period) - timedelta(seconds=1)
        items.append(
            {
                "label": period_label(key, period),
                "start_time": serialize_time(key),
                "end_time": serialize_time(end),
                "download_bytes": download,
                "upload_bytes": upload,
                "total_bytes": download + upload,
            }
        )

    return sorted(items, key=lambda item: item["start_time"], reverse=True)[:safe_limit]
