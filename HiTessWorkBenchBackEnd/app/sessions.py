"""인메모리 세션 스토어 — 서버 재시작 시 초기화되므로 재로그인 필요"""
import uuid
import threading
from datetime import datetime, timedelta


class SessionStore:
    def __init__(self):
        self._sessions: dict[str, dict] = {}
        self._lock = threading.RLock()

    def create(self, employee_id: str) -> str:
        token = str(uuid.uuid4())
        with self._lock:
            self._sessions[token] = {"employee_id": employee_id, "created_at": datetime.now()}
        return token

    def get_employee_id(self, token: str) -> str | None:
        with self._lock:
            s = self._sessions.get(token)
            if not s:
                return None
            if datetime.now() - s["created_at"] > timedelta(hours=24):
                del self._sessions[token]
                return None
            return s["employee_id"]

    def revoke(self, token: str) -> None:
        with self._lock:
            self._sessions.pop(token, None)


session_store = SessionStore()
