import os
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .interfaces import choose_default_interface, is_all_interfaces_value
from .models import AppSetting

MONITORED_INTERFACE_KEY = "monitored_interface"


def configured_interface() -> str:
    return os.getenv("NAS_INTERFACE", "auto").strip() or "auto"


def get_setting(session: Session, key: str) -> str | None:
    setting = session.scalar(select(AppSetting).where(AppSetting.key == key).limit(1))
    return setting.value if setting else None


def set_setting(session: Session, key: str, value: str) -> str:
    now = datetime.now(timezone.utc)
    setting = session.scalar(select(AppSetting).where(AppSetting.key == key).limit(1))
    if setting is None:
        setting = AppSetting(key=key, value=value, created_at=now, updated_at=now)
        session.add(setting)
    else:
        setting.value = value
        setting.updated_at = now
    session.commit()
    return value


def selected_interface(session: Session, available_interfaces: list[str] | None = None) -> str | None:
    stored = get_setting(session, MONITORED_INTERFACE_KEY)
    if stored and not is_all_interfaces_value(stored):
        return stored

    chosen = choose_default_interface(configured_interface(), available_interfaces or [])
    if chosen and not is_all_interfaces_value(chosen):
        return set_setting(session, MONITORED_INTERFACE_KEY, chosen)

    return None


def save_selected_interface(session: Session, interface_name: str) -> str:
    return set_setting(session, MONITORED_INTERFACE_KEY, interface_name)
