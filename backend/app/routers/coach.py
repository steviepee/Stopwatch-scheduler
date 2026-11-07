from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db, utcnow
from app.models import schemas
from app.models.coach import CoachNote

router = APIRouter()


def _get_note(db: Session, note_id: int) -> CoachNote:
    note = db.query(CoachNote).filter(CoachNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Coach note not found")
    return note


@router.get("/notes", response_model=List[schemas.CoachNote])
def get_notes(db: Session = Depends(get_db)):
    return db.query(CoachNote).order_by(CoachNote.created_at, CoachNote.id).all()


@router.post("/notes", response_model=schemas.CoachNote)
def create_note(note: schemas.CoachNoteBase, db: Session = Depends(get_db)):
    db_note = CoachNote(text=note.text)
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note


@router.put("/notes/{note_id}", response_model=schemas.CoachNote)
def update_note(note_id: int, note: schemas.CoachNoteBase, db: Session = Depends(get_db)):
    db_note = _get_note(db, note_id)
    db_note.text = note.text
    db_note.confirmed_at = utcnow()
    db.commit()
    db.refresh(db_note)
    return db_note


@router.delete("/notes/{note_id}")
def delete_note(note_id: int, db: Session = Depends(get_db)):
    db.delete(_get_note(db, note_id))
    db.commit()
    return {"message": "Coach note deleted successfully"}
