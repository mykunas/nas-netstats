from pydantic import BaseModel, Field


class TrafficRecordCreate(BaseModel):
    interface_name: str = Field(min_length=1, max_length=64)
    rx_bytes: int = Field(ge=0)
    tx_bytes: int = Field(ge=0)
    download_speed: float = Field(ge=0)
    upload_speed: float = Field(ge=0)


class CollectorHeartbeat(BaseModel):
    configured_interface: str = Field(min_length=1, max_length=64)
    available_interfaces: list[str] = Field(default_factory=list)
    monitored_interfaces: list[str] = Field(default_factory=list)
    collect_interval: int = Field(ge=1)
    proc_path: str = Field(min_length=1)
