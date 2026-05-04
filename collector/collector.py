import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path


BACKEND_API = os.getenv("BACKEND_API", "http://127.0.0.1:8000").rstrip("/")
HOST_PROC_NET_DEV = Path("/host/proc/net/dev")
PROC_NET_DEV = Path("/proc/net/dev")
CONFIGURED_INTERFACE = (os.getenv("NAS_INTERFACE", "auto").strip() or "auto")
ALL_INTERFACES_VALUES = {"all", "*", "auto", "自动", "全部", "所有"}
CONFIG_REFRESH_INTERVAL = 10
HEARTBEAT_INTERVAL = 10


def read_collect_interval() -> int:
    raw_value = os.getenv("COLLECT_INTERVAL", "5")
    try:
        return max(int(raw_value), 1)
    except ValueError:
        print(f"invalid COLLECT_INTERVAL={raw_value!r}, fallback to 5", flush=True)
        return 5


COLLECT_INTERVAL = read_collect_interval()


@dataclass
class InterfaceCounters:
    rx_bytes: int
    tx_bytes: int


@dataclass
class LastSample:
    interface_name: str
    rx_bytes: int
    tx_bytes: int
    sampled_at: float


def proc_net_dev_path() -> Path:
    if HOST_PROC_NET_DEV.exists():
        return HOST_PROC_NET_DEV
    return PROC_NET_DEV


def read_proc_net_dev() -> tuple[Path, dict[str, InterfaceCounters]]:
    path = proc_net_dev_path()
    interfaces: dict[str, InterfaceCounters] = {}
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if ":" not in line:
                    continue
                name, values = line.split(":", 1)
                interface_name = name.strip()
                if not interface_name:
                    continue
                columns = values.split()
                if len(columns) < 9:
                    continue
                interfaces[interface_name] = InterfaceCounters(rx_bytes=int(columns[0]), tx_bytes=int(columns[8]))
    except FileNotFoundError:
        print(f"traffic source not found: {path}", flush=True)
        return path, {}
    except Exception as exc:
        print(f"failed to read {path}: {exc}", flush=True)
        return path, {}

    return path, interfaces


def is_all_interfaces_mode(interface_name: str | None) -> bool:
    return (interface_name or "").strip().lower() in ALL_INTERFACES_VALUES


def interface_type(interface_name: str) -> str:
    lower = interface_name.lower()
    if lower == "lo":
        return "loopback"
    if lower.startswith("docker") or lower.startswith("br-"):
        return "docker"
    if lower.startswith(("vnet", "tap", "virbr")):
        return "virtual_machine"
    if lower.startswith(("br", "vmbr")):
        return "bridge"
    if lower.startswith(("tun", "wg", "tailscale", "zerotier", "ppp")):
        return "tunnel"
    if lower.startswith(("eth", "enp", "ens", "eno", "wlan", "bond")):
        return "physical"
    return "unknown"


def is_recommended_interface(interface_name: str) -> bool:
    return interface_type(interface_name) == "physical"


def choose_local_default_interface(interfaces: dict[str, InterfaceCounters]) -> str | None:
    names = sorted(interfaces.keys())
    if not is_all_interfaces_mode(CONFIGURED_INTERFACE):
        return CONFIGURED_INTERFACE

    for name in names:
        if is_recommended_interface(name):
            return name

    for name in names:
        if interface_type(name) != "loopback":
            return name

    return None


def calculate_speeds(current: InterfaceCounters, last_sample: LastSample | None, interface_name: str, now: float) -> tuple[float, float]:
    if last_sample is None or last_sample.interface_name != interface_name:
        return 0.0, 0.0

    elapsed = max(now - last_sample.sampled_at, 1.0)
    rx_delta = current.rx_bytes - last_sample.rx_bytes
    tx_delta = current.tx_bytes - last_sample.tx_bytes

    if rx_delta < 0 or tx_delta < 0:
        print(f"interface {interface_name} counters may have reset, speed calculation restarted", flush=True)
        return 0.0, 0.0

    return rx_delta / elapsed, tx_delta / elapsed


def post_json(path: str, payload: dict, label: str) -> None:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{BACKEND_API}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status >= 300:
                print(f"{label} backend returned status {response.status}", flush=True)
    except urllib.error.HTTPError as exc:
        print(f"{label} backend request failed: HTTP {exc.code} {exc.reason}", flush=True)
    except urllib.error.URLError as exc:
        print(f"{label} backend connection failed: {exc.reason}", flush=True)
    except Exception as exc:
        print(f"{label} backend request error: {exc}", flush=True)


def get_json(path: str, label: str) -> dict | None:
    request = urllib.request.Request(f"{BACKEND_API}{path}", method="GET")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status >= 300:
                print(f"{label} backend returned status {response.status}", flush=True)
                return None
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        print(f"{label} backend request failed: HTTP {exc.code} {exc.reason}", flush=True)
    except urllib.error.URLError as exc:
        print(f"{label} backend connection failed: {exc.reason}", flush=True)
    except Exception as exc:
        print(f"{label} backend request error: {exc}", flush=True)
    return None


def post_traffic(payload: dict) -> None:
    post_json("/api/collector/traffic", payload, "traffic")


def read_selected_interface_from_backend() -> str | None:
    payload = get_json("/api/collector/config", "config")
    if not payload:
        return None

    selected = payload.get("selected_interface")
    if isinstance(selected, str) and selected.strip():
        return selected.strip()
    return None


def post_heartbeat(selected_interface: str | None) -> None:
    path, interfaces = read_proc_net_dev()
    payload = {
        "configured_interface": CONFIGURED_INTERFACE,
        "available_interfaces": sorted(interfaces.keys()),
        "monitored_interfaces": [selected_interface] if selected_interface in interfaces else [],
        "interface_counters": [
            {"name": name, "rx_bytes": counters.rx_bytes, "tx_bytes": counters.tx_bytes}
            for name, counters in sorted(interfaces.items())
        ],
        "collect_interval": COLLECT_INTERVAL,
        "proc_path": str(path),
    }
    print(
        "heartbeat "
        f"configured_interface={CONFIGURED_INTERFACE} "
        f"selected_interface={selected_interface or '-'} "
        f"available_interfaces={','.join(payload['available_interfaces']) or '-'} "
        f"proc_path={path}",
        flush=True,
    )
    post_json("/api/collector/heartbeat", payload, "heartbeat")


def resolve_selected_interface(last_selected_interface: str | None, backend_available: bool) -> tuple[str | None, bool]:
    selected = read_selected_interface_from_backend()
    if selected:
        return selected, True

    _, interfaces = read_proc_net_dev()
    fallback = choose_local_default_interface(interfaces)
    if fallback != last_selected_interface or backend_available:
        print(
            "collector config fallback "
            f"configured_interface={CONFIGURED_INTERFACE} "
            f"fallback_interface={fallback or '-'}",
            flush=True,
        )
    return fallback, False


def run() -> None:
    print(
        f"NAS NetStats collector started configured_interface={CONFIGURED_INTERFACE} interval={COLLECT_INTERVAL}s backend={BACKEND_API}",
        flush=True,
    )
    last_sample: LastSample | None = None
    selected_interface: str | None = None
    backend_config_available = False
    next_collect_at = 0.0
    next_config_at = 0.0
    next_heartbeat_at = 0.0

    while True:
        now = time.monotonic()

        if now >= next_config_at:
            selected_interface, backend_config_available = resolve_selected_interface(selected_interface, backend_config_available)
            if selected_interface != (last_sample.interface_name if last_sample else None):
                last_sample = None
            next_config_at = now + CONFIG_REFRESH_INTERVAL

        if now >= next_heartbeat_at:
            try:
                post_heartbeat(selected_interface)
            except Exception as exc:
                print(f"collector heartbeat error: {exc}", flush=True)
            next_heartbeat_at = now + HEARTBEAT_INTERVAL

        if now >= next_collect_at:
            try:
                now = time.monotonic()
                _, interfaces = read_proc_net_dev()
                if not selected_interface:
                    print("no selected interface available, skip this sample", flush=True)
                else:
                    current = interfaces.get(selected_interface)
                    if current is None:
                        print(f"selected interface {selected_interface!r} not found, skip this sample", flush=True)
                        last_sample = None
                    else:
                        download_speed, upload_speed = calculate_speeds(current, last_sample, selected_interface, now)
                        payload = {
                            "interface_name": selected_interface,
                            "rx_bytes": current.rx_bytes,
                            "tx_bytes": current.tx_bytes,
                            "download_speed": download_speed,
                            "upload_speed": upload_speed,
                        }
                        print(
                            "traffic "
                            f"interface={selected_interface} "
                            f"rx_bytes={current.rx_bytes} "
                            f"tx_bytes={current.tx_bytes} "
                            f"download_speed={download_speed:.2f} bytes/s "
                            f"upload_speed={upload_speed:.2f} bytes/s",
                            flush=True,
                        )
                        post_traffic(payload)
                        last_sample = LastSample(
                            interface_name=selected_interface,
                            rx_bytes=current.rx_bytes,
                            tx_bytes=current.tx_bytes,
                            sampled_at=now,
                        )
            except Exception as exc:
                print(f"collector loop error: {exc}", flush=True)
            next_collect_at = now + COLLECT_INTERVAL

        sleep_until = min(next_collect_at, next_config_at, next_heartbeat_at)
        time.sleep(max(0.5, min(1.0, sleep_until - time.monotonic())))


if __name__ == "__main__":
    run()
