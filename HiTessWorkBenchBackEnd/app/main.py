from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile, Form, BackgroundTasks
from fastapi.responses import FileResponse
import urllib.parse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from . import models, schemas, database
import subprocess
import os
import uuid
from datetime import datetime
import psutil
import time
from sqlalchemy import text
from pydantic import BaseModel
from concurrent.futures import ThreadPoolExecutor
import json

# DB 테이블 자동 생성
models.Base.metadata.create_all(bind=database.engine)

app = FastAPI()

# CORS 설정
origins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=False,
  allow_methods=["*"],
  allow_headers=["*"],
)

# ==========================================
# [설정] 서버 버전 및 전역 상태 저장소
# ==========================================
SERVER_VERSION = "1.0.0"

# ✅ [NEW] 해석 서버 동시 실행 제한 (Queue 시스템)
# 현재 서버 사양에 맞춰 최대 동시 실행 개수를 지정합니다.
# 이 숫자를 넘어가면 자동으로 'Pending(대기)' 상태로 큐에 쌓입니다.
MAX_CONCURRENT_JOBS = 5
analysis_executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_JOBS)

# ✅ 비동기 작업 진행도를 저장할 메모리 저장소 (딕셔너리)
# 실제 상화 시에는 Redis로 교체하는 것이 가장 좋습니다.
job_status_store = {}


# 1. 서버 버전 확인 API
@app.get("/api/version")
def check_version():
  return {"version": SERVER_VERSION}


# 2. 헬스 체크 API
@app.get("/")
def health_check():
  return {"status": "ok", "message": "kwonhyukmin"}


# 3. 로그인 API
@app.post("/api/login", response_model=schemas.UserResponse)
def login(request: schemas.LoginRequest, db: Session = Depends(database.get_db)):
  user = db.query(models.User).filter(models.User.employee_id == request.employee_id).first()
  if not user:
    raise HTTPException(status_code=404, detail="User not found")
  if not user.is_active:
    raise HTTPException(status_code=403, detail="Approval Pending")

  user.login_count += 1
  user.last_login = datetime.now()
  db.commit()
  db.refresh(user)

  return user


# 4. 회원가입 API
@app.post("/api/register", response_model=schemas.UserResponse)
def register_user(user: schemas.UserCreate, db: Session = Depends(database.get_db)):
  existing_user = db.query(models.User).filter(models.User.employee_id == user.employee_id).first()
  if existing_user:
    raise HTTPException(status_code=400, detail="Employee ID already registered")

  current_time = datetime.now()
  new_user = models.User(
    employee_id=user.employee_id,
    name=user.name,
    company=user.company,
    department=user.department,
    position=user.position,
    is_active=False,
    is_admin=False,
    login_count=0,
    created_at=current_time
  )

  db.add(new_user)
  db.commit()
  db.refresh(new_user)

  return new_user


# 5. 유저 관리 API
@app.get("/api/users")
def get_users(db: Session = Depends(database.get_db)):
  return db.query(models.User).all()


@app.put("/api/users/{user_id}")
def update_user(user_id: int, update_data: dict, db: Session = Depends(database.get_db)):
  user = db.query(models.User).filter(models.User.id == user_id).first()
  if not user:
    raise HTTPException(status_code=404, detail="User not found")
  for key, value in update_data.items():
    setattr(user, key, value)
  db.commit()
  return {"message": "Update successful"}


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(database.get_db)):
  user = db.query(models.User).filter(models.User.id == user_id).first()
  if not user:
    raise HTTPException(status_code=404, detail="User not found")
  db.delete(user)
  db.commit()
  return {"message": "User deleted"}


# 6. 해석 이력 및 파일 다운로드 API
@app.get("/api/analysis/history/{employee_id}")
def get_analysis_history(employee_id: str, db: Session = Depends(database.get_db)):
  history = db.query(models.Analysis).filter(models.Analysis.employee_id == employee_id).order_by(
    models.Analysis.created_at.desc()).all()
  return history


@app.get("/api/download")
def download_file(filepath: str):
  decoded_path = urllib.parse.unquote(filepath)
  if not os.path.exists(decoded_path):
    raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
  filename = os.path.basename(decoded_path)
  return FileResponse(path=decoded_path, filename=filename, media_type='application/octet-stream')


# ==============================================================================
# [NEW] 비동기 해석 파이프라인 (Background Task & Polling)
# ==============================================================================

# ✅ 7. 작업 진행 상태 조회 API (프론트엔드에서 1~2초마다 찔러봄)
@app.get("/api/analysis/status/{job_id}")
def get_job_status(job_id: str):
  if job_id not in job_status_store:
    raise HTTPException(status_code=404, detail="Job not found")
  return job_status_store[job_id]


# ✅ 8. 실제 해석을 백그라운드에서 수행하는 함수 (별도 스레드에서 동작)
def task_execute_truss(job_id: str, node_path: str, member_path: str, work_dir: str, exe_path: str, exe_dir: str,
                       employee_id: str, timestamp: str, source: str):
  # 시작 상태 업데이트
  job_status_store[job_id].update({"status": "Running", "progress": 10, "message": "Initiating Truss Solver..."})

  input_data = {"node_csv": node_path, "member_csv": member_path}
  result_data = {}
  status_msg = "Success"
  engine_output = ""
  final_bdf_path = None
  project_data = None

  # ⚠️ 백그라운드 스레드에서는 Depends를 쓸 수 없으므로 DB 세션을 직접 열고 닫아야 합니다.
  db = database.SessionLocal()

  try:
    if not os.path.exists(exe_path):
      status_msg = "Failed"
      engine_output = f"Executable not found: {exe_path}"
    else:
      job_status_store[job_id].update({"progress": 40, "message": "Solving Linear Equations..."})
      cmd_args = [exe_path, exe_dir, node_path, member_path]

      try:
        # 외부 EXE 실행 (이 동안 스레드는 블로킹되지만 메인 서버는 멈추지 않음)
        result = subprocess.run(cmd_args, capture_output=True, text=True, check=True)
        engine_output = result.stdout

        job_status_store[job_id].update({"progress": 80, "message": "Extracting Results & Writing BDF..."})

        bdf_files = [f for f in os.listdir(work_dir) if f.endswith('.bdf')]
        if bdf_files:
          final_bdf_path = os.path.join(work_dir, bdf_files[0])
          result_data = {"bdf": final_bdf_path}
        else:
          status_msg = "Failed"
          engine_output += "\n[Error] Engine execution finished, but no .bdf file was created."

      except subprocess.CalledProcessError as e:
        status_msg = "Failed"
        engine_output = e.stderr if e.stderr else e.stdout
      except Exception as e:
        status_msg = "Failed"
        engine_output = f"System Error: {str(e)}"

    # DB 기록 단계
    job_status_store[job_id].update({"progress": 95, "message": "Saving to Database..."})

    try:
      new_analysis = models.Analysis(
        project_name=f"Truss_Job_{timestamp}",
        program_name="TrussModelBuilder",
        employee_id=employee_id,
        status=status_msg,
        input_info=input_data,
        result_info=result_data if status_msg == "Success" else None,
        source=source
      )
      db.add(new_analysis)
      db.commit()
      db.refresh(new_analysis)

      project_data = {
        "id": new_analysis.id,
        "project_name": new_analysis.project_name,
        "program_name": new_analysis.program_name,
        "employee_id": new_analysis.employee_id,
        "status": new_analysis.status,
        "input_info": new_analysis.input_info,
        "result_info": new_analysis.result_info,
        "created_at": new_analysis.created_at.isoformat() if new_analysis.created_at else datetime.now().isoformat()
      }
    except Exception as db_e:
      status_msg = "Failed"
      engine_output += f"\nDB 기록 오류: {str(db_e)}"

    # 🚀 최종 상태 100% 업데이트
    job_status_store[job_id].update({
      "status": status_msg,
      "progress": 100,
      "message": "Analysis Completed Successfully" if status_msg == "Success" else "Analysis Failed",
      "engine_log": engine_output,
      "bdf_path": final_bdf_path,
      "project": project_data
    })

  finally:
    db.close()  # 메모리 누수를 막기 위해 무조건 닫음


# ✅ 9. 해석 '요청' API (파일만 받고 바로 응답)
@app.post("/api/analysis/truss/request")
async def request_truss_analysis(
        background_tasks: BackgroundTasks,
        node_file: UploadFile = File(...),
        member_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("Workbench")
        # 주의: 이 함수 안에서는 DB 세션이 필요 없습니다 (백그라운드가 담당)
):
  base_dir = os.path.dirname(os.path.abspath(__file__))
  parent_dir = os.path.dirname(base_dir)
  timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
  unique_folder = f"{employee_id}_{timestamp}"
  work_dir = os.path.abspath(os.path.join(parent_dir, "userConnection", unique_folder))
  os.makedirs(work_dir, exist_ok=True)

  node_path = os.path.join(work_dir, node_file.filename)
  member_path = os.path.join(work_dir, member_file.filename)

  # 클라이언트가 보낸 CSV 파일 실제 저장
  try:
    with open(node_path, "wb") as buffer:
      buffer.write(await node_file.read())
    with open(member_path, "wb") as buffer:
      buffer.write(await member_file.read())
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"File save error: {str(e)}")

  # ... (위쪽 코드 생략) ...
  exe_dir = os.path.abspath(os.path.join(parent_dir, "InHouseProgram", "TrussModelBuilder"))
  exe_path = os.path.join(exe_dir, "TrussModelBuilder.exe")

  # 🚀 고유 Job ID 생성 및 초기화 (초기 상태를 '대기 중'으로 설정)
  job_id = str(uuid.uuid4())
  job_status_store[job_id] = {"status": "Pending", "progress": 0, "message": "Waiting in Queue..."}

  # 🚀 [수정됨] background_tasks 대신 제한된 큐(ThreadPoolExecutor)에 작업을 밀어 넣음
  analysis_executor.submit(
    task_execute_truss, job_id, node_path, member_path, work_dir, exe_path, exe_dir, employee_id, timestamp, source
  )

  # 서버는 브라우저를 잡고 있지 않고 즉시 ID만 돌려줌
  return {"job_id": job_id}


# ==============================================================================
# [NEW] Support & Community API (CRUD)
# ==============================================================================

# ----------------- Notice (공지사항) -----------------
@app.get("/api/notices", response_model=list[schemas.NoticeResponse])
def get_notices(db: Session = Depends(database.get_db)):
  return db.query(models.Notice).order_by(models.Notice.is_pinned.desc(), models.Notice.created_at.desc()).all()


@app.post("/api/notices", response_model=schemas.NoticeResponse)
def create_notice(notice: schemas.NoticeCreate, db: Session = Depends(database.get_db)):
  new_notice = models.Notice(**notice.dict())
  db.add(new_notice)
  db.commit()
  db.refresh(new_notice)
  return new_notice


@app.put("/api/notices/{notice_id}", response_model=schemas.NoticeResponse)
def update_notice(notice_id: int, notice: schemas.NoticeCreate, db: Session = Depends(database.get_db)):
  db_notice = db.query(models.Notice).filter(models.Notice.id == notice_id).first()
  for key, value in notice.dict().items():
    setattr(db_notice, key, value)
  db.commit()
  db.refresh(db_notice)
  return db_notice


@app.delete("/api/notices/{notice_id}")
def delete_notice(notice_id: int, db: Session = Depends(database.get_db)):
  db_notice = db.query(models.Notice).filter(models.Notice.id == notice_id).first()
  db.delete(db_notice)
  db.commit()
  return {"message": "Deleted"}


# ----------------- Feature Request (기능 요청) -----------------
@app.get("/api/feature-requests", response_model=list[schemas.FeatureRequestResponse])
def get_feature_requests(db: Session = Depends(database.get_db)):
  return db.query(models.FeatureRequest).order_by(models.FeatureRequest.upvotes.desc(),
                                                  models.FeatureRequest.created_at.desc()).all()


@app.post("/api/feature-requests", response_model=schemas.FeatureRequestResponse)
def create_feature_request(req: schemas.FeatureRequestCreate, db: Session = Depends(database.get_db)):
  new_req = models.FeatureRequest(**req.dict())
  db.add(new_req)
  db.commit()
  db.refresh(new_req)
  return new_req


# [복구됨] 따봉(추천) 기능 API
@app.put("/api/feature-requests/{req_id}/upvote")
def upvote_feature_request(req_id: int, db: Session = Depends(database.get_db)):
  req = db.query(models.FeatureRequest).filter(models.FeatureRequest.id == req_id).first()
  if req:
    req.upvotes += 1
    db.commit()
  return {"message": "Upvoted"}


@app.put("/api/feature-requests/{req_id}/comment")
def comment_feature_request(req_id: int, comment_data: schemas.FeatureRequestComment,
                            db: Session = Depends(database.get_db)):
  req = db.query(models.FeatureRequest).filter(models.FeatureRequest.id == req_id).first()
  if req:
    req.status = comment_data.status
    req.admin_comment = comment_data.admin_comment
    req.comments_count = 1 if comment_data.admin_comment else 0
    db.commit()
    db.refresh(req)
  return req


@app.delete("/api/feature-requests/{req_id}")
def delete_feature_request(req_id: int, db: Session = Depends(database.get_db)):
  req = db.query(models.FeatureRequest).filter(models.FeatureRequest.id == req_id).first()
  if req:
    db.delete(req)
    db.commit()
  return {"message": "Deleted"}


# ----------------- User Guide (사용자 가이드) -----------------
@app.get("/api/user-guides", response_model=list[schemas.UserGuideResponse])
def get_user_guides(db: Session = Depends(database.get_db)):
  return db.query(models.UserGuide).order_by(models.UserGuide.category, models.UserGuide.created_at).all()


@app.post("/api/user-guides", response_model=schemas.UserGuideResponse)
def create_user_guide(guide: schemas.UserGuideCreate, db: Session = Depends(database.get_db)):
  new_guide = models.UserGuide(**guide.dict())
  db.add(new_guide)
  db.commit()
  db.refresh(new_guide)
  return new_guide


@app.put("/api/user-guides/{guide_id}")
def update_user_guide(guide_id: int, guide: schemas.UserGuideCreate, db: Session = Depends(database.get_db)):
  db_guide = db.query(models.UserGuide).filter(models.UserGuide.id == guide_id).first()
  if db_guide:
    for key, value in guide.dict().items():
      setattr(db_guide, key, value)
    db.commit()
    db.refresh(db_guide)
  return db_guide


@app.delete("/api/user-guides/{guide_id}")
def delete_user_guide(guide_id: int, db: Session = Depends(database.get_db)):
  db_guide = db.query(models.UserGuide).filter(models.UserGuide.id == guide_id).first()
  if db_guide:
    db.delete(db_guide)
    db.commit()
  return {"message": "Deleted"}


# ==============================================================================
# [NEW] System Monitoring API (Real-time)
# ==============================================================================
@app.get("/api/system/status")
def get_system_status(db: Session = Depends(database.get_db)):
  # 1. CPU 사용량 (현재 순간의 % 반환)
  cpu_usage = psutil.cpu_percent(interval=0.1)

  # 2. 메모리 사용량 (GB 단위로 변환)
  mem = psutil.virtual_memory()
  mem_used_gb = round(mem.used / (1024 ** 3), 1)
  mem_total_gb = round(mem.total / (1024 ** 3), 1)

  # 3. DB 연결 상태 및 응답 속도 (Latency) 측정
  db_status = "Disconnected"
  latency_ms = 0
  try:
    start_time = time.time()
    # 간단한 쿼리로 DB 생존 여부 확인
    db.execute(text("SELECT 1"))
    latency_ms = round((time.time() - start_time) * 1000)
    db_status = "Connected"
  except Exception:
    db_status = "Disconnected"
    latency_ms = 0

  return {
    "cpu_usage": cpu_usage,
    "memory_used_gb": mem_used_gb,
    "memory_total_gb": mem_total_gb,
    "db_status": db_status,
    "latency_ms": latency_ms
  }


@app.get("/api/analysis/all")
def get_all_analysis_history(db: Session = Depends(database.get_db)):
  """관리자용 전체 해석 이력 조회"""
  return db.query(models.Analysis).order_by(models.Analysis.created_at.desc()).all()


# ==============================================================================
# [NEW] AI Assistant (RAG Chatbot) API
# ==============================================================================
class ChatRequest(BaseModel):
  question: str
  chat_history: list[dict] = []
  target_document: str = "all"  # ✅ [신규] 프론트에서 지정한 검색 대상 문서


@app.post("/api/ai/chat")
def ai_chat(req: ChatRequest):
  """React에서 질문, 대화기록, 타겟 문서를 받아 LLM(chain.py)을 통해 답변과 출처를 반환합니다."""
  try:
    from .AI.chain import query

    # ✅ 신규 파라미터 적용
    answer, docs = query(
      question=req.question,
      chat_history=req.chat_history,
      target_document=req.target_document
    )

    # ✅ 답변(answer)과 참조 원문(sources)을 함께 반환
    return {
      "answer": answer,
      "sources": docs
    }
  except Exception as e:
    print(f"AI Chat Error: {e}")
    raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ai/ingest")
def ai_ingest(background_tasks: BackgroundTasks):
  """React에서 버튼을 누르면 백그라운드에서 ingest.py를 실행합니다."""
  try:
    # 실제 ingest.py 안에 있는 함수 이름인 'main'을 가져와서 실행합니다.
    from .AI.ingest import main as ingest_documents

    # BackgroundTasks를 사용하면 브라우저가 멈추지 않고 즉시 응답을 받습니다.
    background_tasks.add_task(ingest_documents)
    return {"message": "지식 DB 학습(Ingest)이 백그라운드에서 시작되었습니다."}
  except Exception as e:
    print(f"AI Ingest Error: {e}")
    raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ai/documents")
def get_ai_documents():
  """학습된 문서(doc_summaries.json)의 메타데이터 및 상태를 반환합니다."""
  try:
    from .AI.config import VECTORSTORE_DIR
    import json
    import os

    # VECTORSTORE_DIR가 Path 객체일 수 있으므로 str로 변환
    summary_path = os.path.join(str(VECTORSTORE_DIR), "doc_summaries.json")

    if os.path.exists(summary_path):
      with open(summary_path, "r", encoding="utf-8") as f:
        docs = json.load(f)
      return {"documents": docs}
    return {"documents": {}}
  except Exception as e:
    print(f"AI Fetch Docs Error: {e}")
    return {"documents": {}}


# ==============================================================================
# [NEW] Server Queue Monitoring API
# ==============================================================================
@app.get("/api/system/queue-status")
def get_queue_status():
  """현재 실행 중인 해석과 큐에서 대기 중인 해석 건수를 반환합니다."""
  running_count = sum(1 for job in job_status_store.values() if job["status"] == "Running")
  pending_count = sum(1 for job in job_status_store.values() if job["status"] == "Pending")

  return {
    "running": running_count,
    "pending": pending_count,
    "limit": MAX_CONCURRENT_JOBS
  }


# ------------------------------------------------------------------------------
# [NEW] Truss Structural Assessment 전용 파일 업로드 및 해석 요청 API
# ------------------------------------------------------------------------------

# ✅ 10. 백그라운드에서 실행될 Dummy 구조 평가 해석 함수
def task_execute_assessment(job_id: str, bdf_path: str, work_dir: str, employee_id: str, timestamp: str, source: str):
  job_status_store[job_id].update(
    {"status": "Running", "progress": 30, "message": "Reading and Validating BDF Matrix..."})
  time.sleep(1)  # BDF 읽기 시뮬레이션

  job_status_store[job_id].update({"progress": 60, "message": "Solving Stiffness Matrix..."})
  time.sleep(2)  # 행렬 계산 시뮬레이션

  job_status_store[job_id].update({"progress": 80, "message": "Generating Assessment Report..."})
  time.sleep(1)  # 리포트 생성 시뮬레이션

  # DB 기록 단계
  job_status_store[job_id].update({"progress": 95, "message": "Saving to Database..."})

  db = database.SessionLocal()
  try:
    new_analysis = models.Analysis(
      project_name=f"Assessment_Job_{timestamp}",
      program_name="Truss Structural Assessment",
      employee_id=employee_id,
      status="Success",
      input_info={"bdf_model": bdf_path},
      result_info={"bdf": bdf_path},  # 우선 시각화를 위해 원본 bdf를 그대로 result_info에 넘김
      source=source
    )
    db.add(new_analysis)
    db.commit()
    db.refresh(new_analysis)

    project_data = {
      "id": new_analysis.id,
      "project_name": new_analysis.project_name,
      "program_name": new_analysis.program_name,
      "employee_id": new_analysis.employee_id,
      "status": new_analysis.status,
      "input_info": new_analysis.input_info,
      "result_info": new_analysis.result_info,
      "created_at": new_analysis.created_at.isoformat() if new_analysis.created_at else datetime.now().isoformat()
    }

    # 완료 상태 100% 업데이트
    job_status_store[job_id].update({
      "status": "Success",
      "progress": 100,
      "message": "Analysis Completed Successfully",
      "engine_log": "Solver executed properly. Assessment reports are generated.",
      "bdf_path": bdf_path,
      "project": project_data
    })
  except Exception as db_e:
    job_status_store[job_id].update({
      "status": "Failed",
      "progress": 100,
      "message": "DB Save Failed",
      "engine_log": f"DB Save Error: {str(db_e)}"
    })
  finally:
    db.close()


# ✅ 11. 구조 평가(Assessment) 전용 BDF 수신 API
@app.post("/api/analysis/assessment/request")
async def request_truss_assessment(
        bdf_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("Workbench")
):
  """프론트엔드에서 BDF 파일을 전송받아 특정 폴더에 물리적으로 저장하고 큐에 작업을 등록합니다."""

  # 1. 파일이 저장될 전용 디렉토리(경로) 세팅
  base_dir = os.path.dirname(os.path.abspath(__file__))
  parent_dir = os.path.dirname(base_dir)
  timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

  # Assessment 전용 폴더명 생성
  unique_folder = f"{employee_id}_assessment_{timestamp}"
  work_dir = os.path.abspath(os.path.join(parent_dir, "userConnection", unique_folder))

  os.makedirs(work_dir, exist_ok=True)

  bdf_path = os.path.join(work_dir, bdf_file.filename)

  # 2. 전송받은 BDF 바이너리 파일을 실제 서버 디스크에 저장
  try:
    with open(bdf_path, "wb") as buffer:
      buffer.write(await bdf_file.read())
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"File save error: {str(e)}")

  # 3. 고유 Job ID 생성 및 메모리 큐 상태 초기화
  job_id = str(uuid.uuid4())
  job_status_store[job_id] = {"status": "Pending", "progress": 0, "message": "Waiting in Queue..."}

  # 4. 제한된 ThreadPoolExecutor를 이용해 백그라운드 해석 작업 시작
  analysis_executor.submit(
    task_execute_assessment, job_id, bdf_path, work_dir, employee_id, timestamp, source
  )

  # 즉시 Job ID만 반환 (브라우저 블로킹 방지)
  return {"job_id": job_id}


# ------------------------------------------------------------------------------
# [NEW] Simple Beam Analyzer 전용 비동기 해석 파이프라인 API
# ------------------------------------------------------------------------------

# ✅ 12. 백그라운드에서 실행될 Simple Beam 해석 함수
def task_execute_beam(job_id: str, input_json_path: str, work_dir: str, employee_id: str, timestamp: str, source: str):
  job_status_store[job_id].update({
    "status": "Running",
    "progress": 10,
    "message": "Initiating Beam Solver..."
  })

  db = database.SessionLocal()
  status_msg = "Success"
  engine_output = ""

  # C# 프로그램이 출력 폴더(work_dir) 안에 만들어낼 예상 결과 파일명 (예: beam_Result.json)
  base_filename = os.path.splitext(os.path.basename(input_json_path))[0]
  result_filename = f"{base_filename}_Result.json"
  result_json_path = os.path.join(work_dir, result_filename)

  # 💡 [반영 완료] 사용자가 지정한 실제 C# 실행 파일 경로
  exe_path = r"C:\Coding\WorkBench\HiTessWorkBenchBackEnd\InHouseProgram\SimpleBeamAssessment\HiTESS.FemEngine.Adapter.exe"

  try:
    job_status_store[job_id].update({"progress": 40, "message": "Executing Solver..."})

    # 💡 [핵심 복구] 사용자의 원래 규칙대로 복구: 실행.exe [beam.json] [BDF 및 결과물 출력 위치(work_dir)]
    cmd_args = [exe_path, input_json_path, work_dir]

    # 외부 프로그램 실행 (안전성을 위해 cwd도 work_dir로 함께 고정)
    result = subprocess.run(
      cmd_args,
      cwd=work_dir,
      capture_output=True,
      text=True,
      check=True
    )
    engine_output = result.stdout

    # C# 실행 후 beam_Result.json 이 제대로 생성되었는지 확인
    if not os.path.exists(result_json_path):
      raise Exception(f"해석은 종료되었으나, 결과 파일({result_filename})이 생성되지 않았습니다. C# 내부 에러를 확인하세요.\n로그: {engine_output}")

    job_status_store[job_id].update({"progress": 80, "message": "Parsing Results..."})

  except subprocess.CalledProcessError as e:
    status_msg = "Failed"
    engine_output = e.stderr if e.stderr else e.stdout
  except Exception as e:
    status_msg = "Failed"
    engine_output = f"System Error: {str(e)}"

  # 2. DB 기록 단계
  job_status_store[job_id].update({"progress": 95, "message": "Saving to Database..."})
  project_data = None

  try:
    new_analysis = models.Analysis(
      project_name=f"SimpleBeam_{timestamp}",
      program_name="Simple Beam Assessment",
      employee_id=employee_id,
      status=status_msg,
      input_info={"input_json": input_json_path},
      result_info={"result_json": result_json_path} if status_msg == "Success" else None,
      source=source
    )
    db.add(new_analysis)
    db.commit()
    db.refresh(new_analysis)

    project_data = {
      "id": new_analysis.id,
      "project_name": new_analysis.project_name,
      "program_name": new_analysis.program_name,
      "employee_id": new_analysis.employee_id,
      "status": new_analysis.status,
      "input_info": new_analysis.input_info,
      "result_info": new_analysis.result_info,
      "created_at": new_analysis.created_at.isoformat() if new_analysis.created_at else datetime.now().isoformat()
    }
  except Exception as db_e:
    status_msg = "Failed"
    engine_output += f"\nDB 기록 오류: {str(db_e)}"
  finally:
    db.close()  # 메모리 누수 방지

  # 3. 완료 상태 100% 업데이트
  job_status_store[job_id].update({
    "status": status_msg,
    "progress": 100,
    "message": "Analysis Completed Successfully" if status_msg == "Success" else "Analysis Failed",
    "engine_log": engine_output,
    "result_path": result_json_path if status_msg == "Success" else None,
    "project": project_data
  })


# ✅ 13. Simple Beam 해석 '요청' API (파일 저장 및 큐 등록)
@app.post("/api/analysis/beam/request")
async def request_beam_analysis(
        beam_file: UploadFile = File(...),
        employee_id: str = Form(...),
        source: str = Form("Workbench")
):
  # 1. 파일이 저장될 전용 디렉토리 세팅
  base_dir = os.path.dirname(os.path.abspath(__file__))
  parent_dir = os.path.dirname(base_dir)

  # 시간 포맷: YYYYMMDD_HHMMSS (예: 20260324_143022)
  timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

  # 💡 [요청 사항 반영] 폴더 네이밍 규칙: 시간_사번_프로그램명
  unique_folder = f"{timestamp}_{employee_id}_SimpleBeam"
  work_dir = os.path.abspath(os.path.join(parent_dir, "userConnection", unique_folder))

  os.makedirs(work_dir, exist_ok=True)

  # 2. JSON 파일을 input.json(또는 빔.json)으로 서버 디스크에 저장
  input_json_path = os.path.join(work_dir, beam_file.filename)
  try:
    with open(input_json_path, "wb") as buffer:
      buffer.write(await beam_file.read())
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"File save error: {str(e)}")

  # 3. 고유 Job ID 생성 및 메모리 큐 상태 초기화
  job_id = str(uuid.uuid4())
  job_status_store[job_id] = {
    "status": "Pending",
    "progress": 0,
    "message": "Waiting in Queue..."
  }

  # 4. 제한된 ThreadPoolExecutor 큐에 백그라운드 해석 작업 밀어넣기
  analysis_executor.submit(
    task_execute_beam, job_id, input_json_path, work_dir, employee_id, timestamp, source
  )

  # 브라우저가 기다리지 않도록 Job ID만 즉시 반환
  return {"job_id": job_id}