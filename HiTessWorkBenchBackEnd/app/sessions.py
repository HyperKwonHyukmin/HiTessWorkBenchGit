"""DB 기반 세션 스토어 — 서버 재시작 후에도 세션 유지, 8시간 만료"""
import uuid
from datetime import datetime, timedelta
from .database import SessionLocal
from . import models

SESSION_TTL = timedelta(hours=8)


class SessionStore:
    def create(self, employee_id: str) -> str:
        token = str(uuid.uuid4())
        now = datetime.now()
        db = SessionLocal()
        try:
            db.add(models.UserSession(
                token=token,
                employee_id=employee_id,
                created_at=now,
                expires_at=now + SESSION_TTL,
            ))
            db.commit()
        finally:
            db.close()
        return token

    def get_employee_id(self, token: str) -> str | None:
        db = SessionLocal()
        try:
            s = db.query(models.UserSession).filter(
                models.UserSession.token == token
            ).first()
            if not s:
                return None
            if datetime.now() > s.expires_at:
                db.delete(s)
                db.commit()
                return None
            return s.employee_id
        finally:
            db.close()

    def revoke(self, token: str) -> None:
        db = SessionLocal()
        try:
            s = db.query(models.UserSession).filter(
                models.UserSession.token == token
            ).first()
            if s:
                db.delete(s)
                db.commit()
        finally:
            db.close()

    def cleanup_expired(self) -> int:
        """만료된 세션 일괄 삭제. 반환값: 삭제된 행 수"""
        db = SessionLocal()
        try:
            deleted = db.query(models.UserSession).filter(
                models.UserSession.expires_at < datetime.now()
            ).delete()
            db.commit()
            return deleted
        finally:
            db.close()


session_store = SessionStore()
