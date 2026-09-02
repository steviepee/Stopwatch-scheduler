from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv

from app.database import engine, Base
from app.routers import tasks, time_logs, calendar_auth, sessions, schedules, insights
import app.models.schedule  # ensure tables are registered with Base

load_dotenv()

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Stopwatch Scheduler API")

# CORS configuration
origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(time_logs.router, prefix="/api/time-logs", tags=["time-logs"])
app.include_router(calendar_auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])
app.include_router(schedules.router, prefix="/api/schedules", tags=["schedules"])
app.include_router(insights.router, prefix="/api/insights", tags=["insights"])

@app.get("/")
def read_root():
    return {"message": "Stopwatch Scheduler API"}

@app.get("/api/health")
def health_check():
    return {"status": "healthy"}
