from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
import os
import hmac
from dotenv import load_dotenv

from app.routers import tasks, time_logs, calendar_auth, sessions, schedules, insights, exports
from app.routers.calendar_auth import SESSION_COOKIE, session_cookie_valid
import app.models.schedule

load_dotenv()

_api_token = os.getenv('API_TOKEN')
if not _api_token:
    raise RuntimeError('API_TOKEN environment variable must be set')

app = FastAPI(title='Stopwatch Scheduler API')

_EXEMPT_PATHS = {'/api/health', '/api/auth/callback'}

_static_dir = Path(os.getenv('STATIC_DIR')).resolve() if os.getenv('STATIC_DIR') else None
if _static_dir and not _static_dir.is_dir():
    _static_dir = None


def _is_api_path(path: str) -> bool:
    return path == '/api' or path.startswith('/api/')

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
    if request.method == 'GET' and request.url.path.startswith('/api/exports/'):
        return await call_next(request)
    if request.method == 'POST' and request.url.path == '/api/auth/web-session':
        return await call_next(request)
    if _static_dir and request.method == 'GET' and not _is_api_path(request.url.path):
        return await call_next(request)
    token = os.getenv('API_TOKEN')
    auth = request.headers.get('Authorization', '')
    if not hmac.compare_digest(auth, f'Bearer {token}') and not session_cookie_valid(
        request.cookies.get(SESSION_COOKIE, ''), token
    ):
        return JSONResponse(status_code=401, content={'detail': 'Not authenticated'})
    return await call_next(request)

app.include_router(tasks.router, prefix='/api/tasks', tags=['tasks'])
app.include_router(time_logs.router, prefix='/api/time-logs', tags=['time-logs'])
app.include_router(calendar_auth.router, prefix='/api/auth', tags=['auth'])
app.include_router(sessions.router, prefix='/api/sessions', tags=['sessions'])
app.include_router(schedules.router, prefix='/api/schedules', tags=['schedules'])
app.include_router(insights.router, prefix='/api/insights', tags=['insights'])
app.include_router(exports.router, prefix='/api/exports', tags=['exports'])

if not _static_dir:
    @app.get('/')
    def read_root():
        return {'message': 'Stopwatch Scheduler API'}

@app.get('/api/health')
def health_check():
    return {'status': 'healthy'}

if _static_dir:
    @app.get('/{path:path}', include_in_schema=False)
    def serve_web_app(path: str):
        if _is_api_path(f'/{path}'):
            return JSONResponse(status_code=404, content={'detail': 'Not Found'})
        file = (_static_dir / path).resolve()
        if path and file.is_file() and file.is_relative_to(_static_dir):
            return FileResponse(file)
        return FileResponse(_static_dir / 'index.html')
