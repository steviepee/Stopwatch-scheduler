from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import hmac
from dotenv import load_dotenv

from app.routers import tasks, time_logs, calendar_auth, sessions, schedules, insights
import app.models.schedule

load_dotenv()

_api_token = os.getenv('API_TOKEN')
if not _api_token:
    raise RuntimeError('API_TOKEN environment variable must be set')

app = FastAPI(title='Stopwatch Scheduler API')

_EXEMPT_PATHS = {'/api/health', '/api/auth/google/login', '/api/auth/callback'}

origins = os.getenv('CORS_ORIGINS', 'http://localhost:3000').split(',')

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

@app.middleware('http')
async def bearer_gate(request: Request, call_next):
    if request.url.path in _EXEMPT_PATHS:
        return await call_next(request)
    token = os.getenv('API_TOKEN')
    auth = request.headers.get('Authorization', '')
    if not hmac.compare_digest(auth, f'Bearer {token}'):
        return JSONResponse(status_code=401, content={'detail': 'Not authenticated'})
    return await call_next(request)

app.include_router(tasks.router, prefix='/api/tasks', tags=['tasks'])
app.include_router(time_logs.router, prefix='/api/time-logs', tags=['time-logs'])
app.include_router(calendar_auth.router, prefix='/api/auth', tags=['auth'])
app.include_router(sessions.router, prefix='/api/sessions', tags=['sessions'])
app.include_router(schedules.router, prefix='/api/schedules', tags=['schedules'])
app.include_router(insights.router, prefix='/api/insights', tags=['insights'])

@app.get('/')
def read_root():
    return {'message': 'Stopwatch Scheduler API'}

@app.get('/api/health')
def health_check():
    return {'status': 'healthy'}
