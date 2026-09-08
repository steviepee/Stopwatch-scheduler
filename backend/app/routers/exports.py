import csv
import io
import json
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.task import Task
from app.models.stopwatch_session import StopwatchSession
from app.models import schemas

router = APIRouter()

_TOKEN_TTL_SECONDS = 60
_tokens: dict = {}

_RESOURCES = {
    "sessions": (StopwatchSession, schemas.StopwatchSession),
    "tasks": (Task, schemas.Task),
}


@router.post("", response_model=schemas.ExportLink)
def create_export(req: schemas.ExportRequest):
    token = secrets.token_urlsafe(32)
    expires_at = time.time() + _TOKEN_TTL_SECONDS
    _tokens[token] = {
        "resource": req.resource,
        "format": req.format,
        "expires_at": expires_at,
    }
    return {"url": f"/api/exports/{token}", "expires_at": expires_at}


@router.get("/{token}")
def download_export(token: str, db: Session = Depends(get_db)):
    entry = _tokens.pop(token, None)
    if entry is None or entry["expires_at"] < time.time():
        raise HTTPException(status_code=404, detail="Not found")

    model, schema = _RESOURCES[entry["resource"]]
    rows = db.query(model).order_by(model.id).all()
    data = [schema.model_validate(row).model_dump(mode="json") for row in rows]
    fieldnames = list(schema.model_fields.keys())

    if entry["format"] == "json":
        content = json.dumps(data)
        media_type = "application/json"
    else:
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for row in data:
            writer.writerow({k: ("" if v is None else v) for k, v in row.items()})
        content = output.getvalue()
        media_type = "text/csv"

    filename = f"{entry['resource']}.{entry['format']}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
