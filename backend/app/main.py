from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, func, select, text

from .database import SessionLocal, create_tables
from . import models
from .interfaces import HOST_PROC_NET_DEV, InterfaceCounters, build_interface_info, read_proc_net_dev, sort_interface_infos
from .schemas import CollectorHeartbeat, InterfaceSelectRequest, TrafficRecordCreate
from .settings import configured_interface, save_selected_interface, selected_interface
from .stats import dashboard_summary, realtime_records, serialize_time, traffic_history

NAS_INTERFACE = configured_interface()


def read_collect_interval() -> int:
    try:
        return max(int(os.getenv("COLLECT_INTERVAL", "5")), 1)
    except ValueError:
        return 5


latest_collector_heartbeat: dict | None = None


def heartbeat_interface_counters() -> dict[str, InterfaceCounters]:
    heartbeat = latest_collector_heartbeat or {}
    counters: dict[str, InterfaceCounters] = {}
    for item in heartbeat.get("interface_counters") or []:
        try:
            counters[str(item["name"])] = InterfaceCounters(
                rx_bytes=int(item.get("rx_bytes") or 0),
                tx_bytes=int(item.get("tx_bytes") or 0),
            )
        except Exception:
            continue
    return counters


def available_interface_counters() -> dict[str, InterfaceCounters]:
    counters = heartbeat_interface_counters()
    if counters:
        return counters

    heartbeat = latest_collector_heartbeat or {}
    available = heartbeat.get("available_interfaces") or []
    if available:
        return {name: InterfaceCounters(rx_bytes=0, tx_bytes=0) for name in available}

    if HOST_PROC_NET_DEV.exists():
        _, local_counters = read_proc_net_dev()
        return local_counters

    return {}


def interface_infos_for_selection(session) -> tuple[str | None, list[dict]]:
    counters = available_interface_counters()
    names = sorted(counters.keys())
    current_selected = selected_interface(session, names)
    infos = [
        build_interface_info(name, counters.get(name), current_selected)
        for name in names
    ]
    return current_selected, sort_interface_infos(infos)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        create_tables()
    except Exception as exc:
        print(f"database init failed: {exc}", flush=True)
    yield


app = FastAPI(title="NAS NetStats API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/api/db/status")
async def db_status() -> dict:
    try:
        create_tables()
        with SessionLocal() as session:
            session.execute(text("select 1"))
        return {"status": "connected"}
    except Exception as exc:
        return {"status": "disconnected", "error": str(exc)}


@app.post("/api/collector/traffic")
async def create_traffic_record(payload: TrafficRecordCreate) -> dict:
    try:
        with SessionLocal() as session:
            record = models.TrafficRecord(**payload.model_dump())
            session.add(record)
            session.commit()
            session.refresh(record)
            return {"status": "ok", "id": record.id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/collector/heartbeat")
async def collector_heartbeat(payload: CollectorHeartbeat) -> dict:
    global latest_collector_heartbeat
    latest_collector_heartbeat = {
        **payload.model_dump(),
        "received_at": datetime.now(timezone.utc),
    }
    return {"status": "ok"}


@app.get("/api/system/status")
async def system_status() -> dict:
    heartbeat = latest_collector_heartbeat or {}
    configured = heartbeat.get("configured_interface") or NAS_INTERFACE
    collect_interval = heartbeat.get("collect_interval") or read_collect_interval()

    try:
        with SessionLocal() as session:
            session.execute(text("select 1"))
            current_selected, interface_infos = interface_infos_for_selection(session)
            available_interfaces = [item["name"] for item in interface_infos]
            recommended_interfaces = [item["name"] for item in interface_infos if item["is_recommended"]]
            ignored_interfaces = [item["name"] for item in interface_infos if not item["is_recommended"]]
            latest_record = session.scalar(
                select(models.TrafficRecord)
                .where(models.TrafficRecord.interface_name == current_selected)
                .order_by(desc(models.TrafficRecord.created_at), desc(models.TrafficRecord.id))
                .limit(1)
            ) if current_selected else None
            total_records = session.scalar(
                select(func.count(models.TrafficRecord.id)).where(models.TrafficRecord.interface_name == current_selected)
            ) if current_selected else 0
            total_records = total_records or 0
            now = datetime.now(timezone.utc)
            seconds_since_last_record = None
            if latest_record is not None:
                latest_time = latest_record.created_at
                if latest_time.tzinfo is None:
                    latest_time = latest_time.replace(tzinfo=timezone.utc)
                seconds_since_last_record = max(int((now - latest_time.astimezone(timezone.utc)).total_seconds()), 0)

            if total_records == 0:
                collector_status = "no_data"
            elif seconds_since_last_record is not None and seconds_since_last_record <= 15:
                collector_status = "online"
            else:
                collector_status = "stale"

            return {
                "backend_status": "ok",
                "database_status": "connected",
                "collector_status": collector_status,
                "configured_interface": configured,
                "selected_interface": current_selected,
                "latest_interface": latest_record.interface_name if latest_record else None,
                "latest_record_time": serialize_time(latest_record.created_at if latest_record else None),
                "seconds_since_last_record": seconds_since_last_record,
                "total_records": total_records,
                "available_interfaces": available_interfaces,
                "recommended_interfaces": recommended_interfaces,
                "ignored_interfaces": ignored_interfaces,
                "monitored_interfaces": [current_selected] if current_selected else [],
                "collect_interval": collect_interval,
            }
    except Exception as exc:
        counters = available_interface_counters()
        available_interfaces = sorted(counters.keys())
        return {
            "backend_status": "ok",
            "database_status": "disconnected",
            "collector_status": "no_data",
            "configured_interface": configured,
            "selected_interface": None,
            "latest_interface": None,
            "latest_record_time": None,
            "seconds_since_last_record": None,
            "total_records": 0,
            "available_interfaces": available_interfaces,
            "recommended_interfaces": [],
            "ignored_interfaces": available_interfaces,
            "monitored_interfaces": [],
            "collect_interval": collect_interval,
            "error": str(exc),
        }


@app.get("/api/dashboard/summary")
async def get_dashboard_summary() -> dict:
    try:
        with SessionLocal() as session:
            current_selected = selected_interface(session, sorted(available_interface_counters().keys()))
            return dashboard_summary(session, current_selected)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/traffic/realtime")
async def get_realtime_traffic(limit: int = Query(300, ge=1)) -> list[dict]:
    try:
        with SessionLocal() as session:
            current_selected = selected_interface(session, sorted(available_interface_counters().keys()))
            return realtime_records(session, limit, current_selected)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/traffic/history")
async def get_traffic_history(
    period: str = Query("week", pattern="^(day|week|month|year)$"),
    limit: int = Query(100, ge=1, le=1000),
) -> list[dict]:
    try:
        with SessionLocal() as session:
            current_selected = selected_interface(session, sorted(available_interface_counters().keys()))
            return traffic_history(session, period, limit, current_selected)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/traffic/export.csv")
async def export_traffic_history_csv(
    period: str = Query("week", pattern="^(day|week|month|year)$"),
    limit: int = Query(100, ge=1, le=1000),
) -> StreamingResponse:
    try:
        with SessionLocal() as session:
            current_selected = selected_interface(session, sorted(available_interface_counters().keys()))
            items = traffic_history(session, period, limit, current_selected)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = ["日期,开始时间,结束时间,上传,下载,总流量"]
    for item in items:
        rows.append(
            ",".join(
                [
                    str(item["label"]),
                    str(item["start_time"]),
                    str(item["end_time"]),
                    str(item["upload_bytes"]),
                    str(item["download_bytes"]),
                    str(item["total_bytes"]),
                ]
            )
        )
    csv_body = "\ufeff" + "\n".join(rows) + "\n"
    return StreamingResponse(
        iter([csv_body]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="nas-netstats-history-{period}.csv"'},
    )


@app.get("/api/system/interfaces")
async def system_interfaces() -> dict:
    try:
        with SessionLocal() as session:
            current_selected, interface_infos = interface_infos_for_selection(session)
            return {
                "configured_interface": NAS_INTERFACE,
                "selected_interface": current_selected,
                "interfaces": interface_infos,
            }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/system/interfaces/select")
async def select_system_interface(payload: InterfaceSelectRequest) -> dict:
    requested = payload.interface_name.strip()
    try:
        with SessionLocal() as session:
            _, interface_infos = interface_infos_for_selection(session)
            available_names = {item["name"] for item in interface_infos}
            if requested not in available_names:
                raise HTTPException(status_code=400, detail=f"网卡 {requested} 不在当前可用网卡列表中")

            save_selected_interface(session, requested)
            return {
                "selected_interface": requested,
                "message": f"监控网卡已切换为 {requested}",
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/collector/config")
async def collector_config() -> dict:
    try:
        with SessionLocal() as session:
            current_selected = selected_interface(session, sorted(available_interface_counters().keys()))
            return {
                "selected_interface": current_selected,
                "collect_interval": read_collect_interval(),
            }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
