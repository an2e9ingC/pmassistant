"""WeCom (企业微信) checkin & schedule data models."""
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Text
from sqlalchemy.sql import func
from backend.database import Base


class WeComCheckin(Base):
    """WeCom checkin (punch-in) + approval records.

    Each record is one day's aggregated checkin or approval hours for a user.
    Uniquely identified by (user_id, date, source).
    """

    __tablename__ = "pma_wecom_checkins"

    id = Column(Integer, primary_key=True)
    user_id = Column(String(128), nullable=False, index=True)  # WeCom userid
    date = Column(Date, nullable=False, index=True)             # checkin date
    work_hours = Column(Float, default=0.0)                     # total work hours
    source = Column(String(20), default="checkin")              # "checkin" or "approval"
    expected_hours = Column(Float, default=0.0)                 # expected hours from checkin rules
    checkin_count = Column(Integer, default=0)                  # number of actual punch records
    raw_data = Column(Text, nullable=True)                      # JSON blob of raw API record
    synced_at = Column(DateTime, default=func.now())            # last sync time


class WeComUser(Base):
    """WeCom user/department list synced from address book."""

    __tablename__ = "pma_wecom_users"

    id = Column(Integer, primary_key=True)
    userid = Column(String(128), unique=True, nullable=False, index=True)
    name = Column(String(128), nullable=False)
    department = Column(String(256), nullable=True)
    raw_data = Column(Text, nullable=True)  # JSON
    synced_at = Column(DateTime, default=func.now())


class WeComSchedule(Base):
    """WeCom expected working hours per month (from company schedule)."""

    __tablename__ = "pma_wecom_schedule"

    id = Column(Integer, primary_key=True)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    work_days = Column(Integer, default=0)
    work_hours = Column(Float, default=0.0)
    raw_data = Column(Text, nullable=True)  # JSON
    synced_at = Column(DateTime, default=func.now())
