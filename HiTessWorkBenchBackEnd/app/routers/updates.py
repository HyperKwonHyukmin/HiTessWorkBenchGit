"""관리자 '업데이트 이력' — WorkBench 에 더해지고 바뀐 것(Administration > Update History).

내용은 app/changelog/changelog.json(새 항목은 items 맨 앞에)이고 요청마다 다시 읽는다.
그래서 json 만 고쳐 서버에 올리면 exe 재배포·백엔드 재시작 없이 다음 조회부터 바뀐다.
화면은 앱 안 관리자 페이지(pages/Administration/UpdateHistory.jsx)라 관리자 게이트를 그대로 거친다.
"""
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import require_admin

router = APIRouter(prefix="/api/admin", tags=["updates"])

DATA = Path(__file__).resolve().parent.parent / "changelog" / "changelog.json"


def load_items(path: Path = DATA) -> list[dict]:
    """json 의 items(최신이 맨 앞). 파일이 없거나 깨졌으면 ValueError."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"업데이트 이력 파일을 읽지 못했습니다: {e}") from e
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ValueError("업데이트 이력 파일에 items 목록이 없습니다.")
    return items


@router.get("/updates")
def list_updates(_admin: str = Depends(require_admin)):
    try:
        return {"items": load_items()}
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
