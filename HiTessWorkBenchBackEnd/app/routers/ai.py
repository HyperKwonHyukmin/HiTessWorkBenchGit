"""AI Assistant (RAG Chatbot) API 라우터."""
import os
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from ..dependencies import require_auth, require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ai"])


class ChatRequest(BaseModel):
  question: str
  chat_history: list[dict] = []
  target_document: str = "all"


@router.post("/ai/chat")
def ai_chat(req: ChatRequest, current_user: str = Depends(require_auth)):
  """React에서 질문, 대화기록, 타겟 문서를 받아 LLM(chain.py)을 통해 답변과 출처를 반환합니다."""
  try:
    from ..AI.chain import query

    answer, docs = query(
      question=req.question,
      chat_history=req.chat_history,
      target_document=req.target_document
    )

    return {
      "answer": answer,
      "sources": docs
    }
  except Exception as e:
    logger.error(f"AI Chat Error: {e}")
    raise HTTPException(status_code=500, detail="AI 응답 처리 중 오류가 발생했습니다.")


@router.post("/ai/ingest")
def ai_ingest(background_tasks: BackgroundTasks, current_admin: str = Depends(require_admin)):
  """React에서 버튼을 누르면 백그라운드에서 ingest.py를 실행합니다."""
  try:
    from ..AI.ingest import main as ingest_documents

    background_tasks.add_task(ingest_documents)
    return {"message": "지식 DB 학습(Ingest)이 백그라운드에서 시작되었습니다."}
  except Exception as e:
    logger.error(f"AI Ingest Error: {e}")
    raise HTTPException(status_code=500, detail="Ingest 처리 중 오류가 발생했습니다.")


@router.get("/ai/documents")
def get_ai_documents(current_user: str = Depends(require_auth)):
  """학습된 문서(doc_summaries.json)의 메타데이터 및 상태를 반환합니다."""
  try:
    from ..AI.config import VECTORSTORE_DIR

    summary_path = os.path.join(str(VECTORSTORE_DIR), "doc_summaries.json")

    if os.path.exists(summary_path):
      with open(summary_path, "r", encoding="utf-8") as f:
        docs = json.load(f)
      return {"documents": docs}
    return {"documents": {}}
  except Exception as e:
    logger.error(f"AI Fetch Docs Error: {e}")
    return {"documents": {}}
