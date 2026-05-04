from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


ALL_INTERFACE_VALUES = {"all", "*", "auto", "自动", "全部", "所有"}
HOST_PROC_NET_DEV = Path("/host/proc/net/dev")
PROC_NET_DEV = Path("/proc/net/dev")


@dataclass(frozen=True)
class InterfaceCounters:
    rx_bytes: int
    tx_bytes: int


def is_all_interfaces_value(value: str | None) -> bool:
    return (value or "").strip().lower() in ALL_INTERFACE_VALUES


def classify_interface(interface_name: str) -> tuple[str, bool, str]:
    name = interface_name.strip()
    lower = name.lower()

    if lower == "lo":
        return "loopback", False, "回环网卡，不建议作为总流量统计"
    if lower.startswith("docker") or lower.startswith("br-"):
        return "docker", False, "Docker 网卡，不建议作为 NAS 总流量"
    if lower.startswith(("vnet", "tap", "virbr")):
        return "virtual_machine", False, "虚拟机网卡，可能造成重复统计"
    if lower.startswith(("br", "vmbr")):
        return "bridge", False, "桥接网卡，可能与物理网卡重复统计"
    if lower.startswith(("tun", "wg", "tailscale", "zerotier", "ppp")):
        return "tunnel", False, "隧道或虚拟网络，不建议作为 NAS 总流量"
    if lower.startswith(("eth", "enp", "ens", "eno", "wlan", "bond")):
        return "physical", True, "推荐：疑似物理网卡"
    return "unknown", False, "未知网卡类型，请确认是否为 NAS 主网卡"


def build_interface_info(
    interface_name: str,
    counters: InterfaceCounters | None,
    selected_interface: str | None,
) -> dict:
    interface_type, is_recommended, reason = classify_interface(interface_name)
    return {
        "name": interface_name,
        "type": interface_type,
        "is_recommended": is_recommended,
        "is_selected": interface_name == selected_interface,
        "rx_bytes": counters.rx_bytes if counters else 0,
        "tx_bytes": counters.tx_bytes if counters else 0,
        "reason": reason,
    }


def sort_interface_infos(items: list[dict]) -> list[dict]:
    type_order = {
        "physical": 0,
        "bridge": 1,
        "docker": 2,
        "virtual_machine": 3,
        "tunnel": 4,
        "loopback": 5,
        "unknown": 6,
    }
    return sorted(items, key=lambda item: (type_order.get(str(item["type"]), 99), str(item["name"])))


def choose_default_interface(configured_interface: str, interface_names: list[str]) -> str | None:
    if configured_interface and not is_all_interfaces_value(configured_interface):
        return configured_interface

    for name in interface_names:
        _, is_recommended, _ = classify_interface(name)
        if is_recommended:
            return name

    for name in interface_names:
        interface_type, _, _ = classify_interface(name)
        if interface_type != "loopback":
            return name

    return None


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
                interfaces[interface_name] = InterfaceCounters(
                    rx_bytes=int(columns[0]),
                    tx_bytes=int(columns[8]),
                )
    except FileNotFoundError:
        return path, {}
    except Exception:
        return path, {}

    return path, interfaces
