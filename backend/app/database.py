from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()


def db_connection_settings():
    url = URL.create(
        "mysql+pymysql",
        username=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        database=os.getenv("DB_NAME", "stopwatch_scheduler"),
    )
    ssl_ca = os.getenv("DB_SSL_CA")
    connect_args = {"ssl": {"ca": ssl_ca}} if ssl_ca else {}
    return url, connect_args


_url, _connect_args = db_connection_settings()
# Azure drops idle connections; check before use and recycle before its idle cutoff.
engine = create_engine(_url, connect_args=_connect_args, pool_pre_ping=True, pool_recycle=240)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency to get database session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def utcnow():
    """Naive UTC now — all DB datetimes are stored as UTC."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).replace(tzinfo=None)
