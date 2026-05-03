from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc, func, select, text

from .database import SessionLocal, create_tables
from . import models
from .schemas import CollectorHeartbeat, TrafficRecordCreate
from .stats import dashboard_summary, realtime_records, serialize_time, traffic_history

NAS_INTERFACE = os.getenv("NAS_INTERFACE", "all")


def read_collect_interval() -> int:
    try:
        return max(int(os.getenv("COLLECT_INTERVAL", "5")), 1)
    except ValueError:
        return 5


latest_collector_heartbeat: dict | None = None


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
    configured_interface = heartbeat.get("configured_interface") or NAS_INTERFACE
    collect_interval = heartbeat.get("collect_interval") or read_collect_interval()
    available_interfaces = heartbeat.get("available_interfaces") or []
    monitored_interfaces = heartbeat.get("monitored_interfaces") or []

    try:
        with SessionLocal() as session:
            session.execute(text("select 1"))
            latest_record = session.scalar(
                select(models.TrafficRecord).order_by(desc(models.TrafficRecord.created_at), desc(models.TrafficRecord.id)).limit(1)
            )
            total_records = session.scalar(select(func.count(models.TrafficRecord.id))) or 0
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
                "configured_interface": configured_interface,
                "latest_interface": latest_record.interface_name if latest_record else None,
                "latest_record_time": serialize_time(latest_record.created_at if latest_record else None),
                "seconds_since_last_record": seconds_since_last_record,
                "total_records": total_records,
                "available_interfaces": available_interfaces,
                "monitored_interfaces": monitored_interfaces,
                "collect_interval": collect_interval,
            }
    except Exception as exc:
        return {
            "backend_status": "ok",
            "database_status": "disconnected",
            "collector_status": "no_data",
            "configured_interface": configured_interface,
            "latest_interface": None,
            "latest_record_time": None,
            "seconds_since_last_record": None,
            "total_records": 0,
            "available_interfaces": available_interfaces,
            "monitored_interfaces": monitored_interfaces,
            "collect_interval": collect_interval,
            "error": str(exc),
        }


@app.get("/api/dashboard/summary")
async def get_dashboard_summary() -> dict:
    try:
        with SessionLocal() as session:
            return dashboard_summary(session)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/traffic/realtime")
async def get_realtime_traffic(limit: int = Query(300, ge=1)) -> list[dict]:
    try:
        with SessionLocal() as session:
            return realtime_records(session, limit)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/traffic/history")
async def get_traffic_history(
    period: str = Query("week", pattern="^(day|week|month|year)$"),
    limit: int = Query(100, ge=1, le=1000),
) -> list[dict]:
    try:
        with SessionLocal() as session:
            return traffic_history(session, period, limit)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
