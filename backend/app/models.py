from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class TrafficRecord(Base):
    __tablename__ = "traffic_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    interface_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    rx_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tx_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    download_speed: Mapped[float] = mapped_column(Float, nullable=False)
    upload_speed: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
