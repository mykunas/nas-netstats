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
NAS_INTERFACE = (os.getenv("NAS_INTERFACE", "all").strip() or "all")
ALL_INTERFACES_VALUES = {"all", "*", "全部", "所有"}
EXCLUDED_INTERFACE_PREFIXES = (
    "lo",
    "docker",
    "veth",
    "br-",
    "virbr",
    "cni",
    "flannel",
    "kube",
    "podman",
)


def read_collect_interval() -> int:
    raw_value = os.getenv("COLLECT_INTERVAL", "5")
    try:
        return max(int(raw_value), 1)
    except ValueError:
        print(f"invalid COLLECT_INTERVAL={raw_value!r}, fallback to 5", flush=True)
        return 5


COLLECT_INTERVAL = read_collect_interval()
HEARTBEAT_INTERVAL = 10


@dataclass
class InterfaceCounters:
    rx_bytes: int
    tx_bytes: int


@dataclass
class LastSample:
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


def read_interface_counters(interface_name: str) -> InterfaceCounters | None:
    path, interfaces = read_proc_net_dev()
    counters = interfaces.get(interface_name)
    if counters is not None:
        return counters

    print(f"interface {interface_name!r} not found in {path}", flush=True)
    return None


def is_all_interfaces_mode(interface_name: str) -> bool:
    return interface_name.strip().lower() in ALL_INTERFACES_VALUES


def is_collectable_interface(interface_name: str) -> bool:
    normalized = interface_name.strip()
    if not normalized:
        return False
    return not any(normalized.startswith(prefix) for prefix in EXCLUDED_INTERFACE_PREFIXES)


def collectable_interface_names(interfaces: dict[str, InterfaceCounters]) -> list[str]:
    return sorted(name for name in interfaces if is_collectable_interface(name))


def aggregate_counters(interfaces: dict[str, InterfaceCounters], interface_names: list[str]) -> InterfaceCounters | None:
    if not interface_names:
        return None

    return InterfaceCounters(
        rx_bytes=sum(interfaces[name].rx_bytes for name in interface_names),
        tx_bytes=sum(interfaces[name].tx_bytes for name in interface_names),
    )


def read_monitored_counters() -> tuple[InterfaceCounters | None, list[str]]:
    path, interfaces = read_proc_net_dev()
    if is_all_interfaces_mode(NAS_INTERFACE):
        monitored_interfaces = collectable_interface_names(interfaces)
        counters = aggregate_counters(interfaces, monitored_interfaces)
        if counters is None:
            print(f"no collectable NAS interfaces found in {path}", flush=True)
        return counters, monitored_interfaces

    counters = interfaces.get(NAS_INTERFACE)
    if counters is None:
        print(f"interface {NAS_INTERFACE!r} not found in {path}", flush=True)
        return None, []

    return counters, [NAS_INTERFACE]


def calculate_speeds(current: InterfaceCounters, last_sample: LastSample | None, now: float) -> tuple[float, float]:
    if last_sample is None:
        return 0.0, 0.0

    elapsed = max(now - last_sample.sampled_at, 1.0)
    rx_delta = current.rx_bytes - last_sample.rx_bytes
    tx_delta = current.tx_bytes - last_sample.tx_bytes

    if rx_delta < 0 or tx_delta < 0:
        print("interface counters may have reset, speed calculation restarted", flush=True)
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


def post_traffic(payload: dict) -> None:
    post_json("/api/collector/traffic", payload, "traffic")


def post_heartbeat() -> None:
    path, interfaces = read_proc_net_dev()
    monitored_interfaces = collectable_interface_names(interfaces) if is_all_interfaces_mode(NAS_INTERFACE) else ([NAS_INTERFACE] if NAS_INTERFACE in interfaces else [])
    payload = {
        "configured_interface": NAS_INTERFACE,
        "available_interfaces": sorted(interfaces.keys()),
        "monitored_interfaces": monitored_interfaces,
        "collect_interval": COLLECT_INTERVAL,
        "proc_path": str(path),
    }
    print(
        "heartbeat "
        f"interface={NAS_INTERFACE} "
        f"monitored_interfaces={','.join(monitored_interfaces) or '-'} "
        f"available_interfaces={','.join(payload['available_interfaces']) or '-'} "
        f"proc_path={path}",
        flush=True,
    )
    post_json("/api/collector/heartbeat", payload, "heartbeat")


def run() -> None:
    print(
        f"NAS NetStats collector started interface={NAS_INTERFACE} interval={COLLECT_INTERVAL}s backend={BACKEND_API}",
        flush=True,
    )
    last_sample: LastSample | None = None
    next_collect_at = 0.0
    next_heartbeat_at = 0.0

    while True:
        now = time.monotonic()

        if now >= next_heartbeat_at:
            try:
                post_heartbeat()
            except Exception as exc:
                print(f"collector heartbeat error: {exc}", flush=True)
            next_heartbeat_at = now + HEARTBEAT_INTERVAL

        if now >= next_collect_at:
            try:
                now = time.monotonic()
                current, monitored_interfaces = read_monitored_counters()
                if current is not None:
                    download_speed, upload_speed = calculate_speeds(current, last_sample, now)
                    payload = {
                        "interface_name": "all" if is_all_interfaces_mode(NAS_INTERFACE) else NAS_INTERFACE,
                        "rx_bytes": current.rx_bytes,
                        "tx_bytes": current.tx_bytes,
                        "download_speed": download_speed,
                        "upload_speed": upload_speed,
                    }
                    print(
                        "traffic "
                        f"interface={payload['interface_name']} "
                        f"monitored_interfaces={','.join(monitored_interfaces) or '-'} "
                        f"rx_bytes={current.rx_bytes} "
                        f"tx_bytes={current.tx_bytes} "
                        f"download_speed={download_speed:.2f} bytes/s "
                        f"upload_speed={upload_speed:.2f} bytes/s",
                        flush=True,
                    )
                    post_traffic(payload)
                    last_sample = LastSample(
                        rx_bytes=current.rx_bytes,
                        tx_bytes=current.tx_bytes,
                        sampled_at=now,
                    )
            except Exception as exc:
                print(f"collector loop error: {exc}", flush=True)
            next_collect_at = now + COLLECT_INTERVAL

        sleep_until = min(next_collect_at, next_heartbeat_at)
        time.sleep(max(0.5, min(1.0, sleep_until - time.monotonic())))


if __name__ == "__main__":
    run()
