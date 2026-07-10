from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, JSON, Float, Text
from sqlalchemy.sql import func
from .database import Base
from datetime import datetime

class User(Base):
  __tablename__ = "users"
  id = Column(Integer, primary_key=True, index=True)
  employee_id = Column(String(50), unique=True, index=True)
  name = Column(String(50))
  company = Column(String(100))
  department = Column(String(100), nullable=True)
  position = Column(String(50))
  is_active = Column(Boolean, default=False)
  is_admin = Column(Boolean, default=False)
  # 개발자 권한 — 해석 통계에서 자동 제외 (테스트성 실행으로 통계 왜곡 방지)
  is_developer = Column(Boolean, default=False)

  login_count = Column(Integer, default=0)  # 로그인 횟수 (기본값 0)
  last_login = Column(DateTime(timezone=True), nullable=True)  # 마지막 로그인 시간
  created_at = Column(DateTime(timezone=True), default=datetime.now)


class UserSession(Base):
  __tablename__ = "user_sessions"
  token       = Column(String(36), primary_key=True)
  employee_id = Column(String(50), nullable=False, index=True)
  created_at  = Column(DateTime, default=datetime.now)
  expires_at  = Column(DateTime, nullable=False)


class UserPresence(Base):
  """실시간 접속 상태 — 클라이언트 하트비트로 갱신. 사용자당 1행(사번 PK).

  세션(user_sessions) 인증과 분리한 별도 테이블이라 create_all 로 자동 생성된다.
  last_seen 이 임계시간 이내면 '접속 중'으로 판정한다(app/routers/presence.py)."""
  __tablename__ = "user_presence"
  employee_id = Column(String(50), primary_key=True)   # 대문자 정규화된 사번
  last_seen   = Column(DateTime, default=datetime.now, index=True)
  last_ip     = Column(String(50), nullable=True)       # 서버가 관측한 client IP
  last_page   = Column(String(200), nullable=True)      # 하트비트 시점의 현재 페이지


class Analysis(Base):
  __tablename__ = "analysis"
  id = Column(Integer, primary_key=True, index=True)
  job_id = Column(String(50), unique=True, index=True, nullable=True)
  project_name = Column(String(200), nullable=True)
  program_name = Column(String(100))
  employee_id = Column(String(50), index=True)
  status = Column(String(50))
  job_status = Column(String(20), default="completed")
  progress = Column(Integer, default=100)
  job_message = Column(Text, nullable=True)
  input_info = Column(JSON)
  result_info = Column(JSON)

  # [신규 추가] 해석 요청 출처 (예: 'Workbench', 'External API' 등)
  source = Column(String(50), default="Workbench")

  created_at = Column(DateTime(timezone=True), server_default=func.now())
  started_at = Column(DateTime(timezone=True), nullable=True)
  updated_at = Column(DateTime(timezone=True), nullable=True)

# [기존 Analysis 클래스 아래에 다음 코드 추가]

class Notice(Base):
    __tablename__ = "notices"
    id = Column(Integer, primary_key=True, index=True)
    type = Column(String(50))  # Update, Notice 등
    title = Column(String(200))
    content = Column(String(2000))
    is_pinned = Column(Boolean, default=False)
    is_private = Column(Boolean, default=False)
    author_id = Column(String(50))
    author_name = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.now)


class UserGuide(Base):
  __tablename__ = "user_guides"
  id = Column(Integer, primary_key=True, index=True)
  category = Column(String(100))
  title = Column(String(200))
  content = Column(Text)
  author_id = Column(String(50))
  created_at = Column(DateTime(timezone=True), default=datetime.now)


class FeatureRequest(Base):
  __tablename__ = "feature_requests"
  id = Column(Integer, primary_key=True, index=True)
  title = Column(String(200))
  content = Column(String(5000))
  status = Column(String(50), default="Under Review")
  upvotes = Column(Integer, default=0)
  comments_count = Column(Integer, default=0)
  author_id = Column(String(50))
  author_name = Column(String(50))
  admin_comment = Column(String(5000), nullable=True)  # 관리자 댓글
  created_at = Column(DateTime(timezone=True), default=datetime.now)


class ActivityLog(Base):
  __tablename__ = "activity_logs"
  id = Column(Integer, primary_key=True, index=True)
  employee_id = Column(String(50), index=True, nullable=True)
  action_type = Column(String(50), index=True)  # LOGIN, LOGOUT, FILE_DOWNLOAD, PROGRAM_DOWNLOAD, VERSION_UPDATE
  action_detail = Column(JSON, nullable=True)
  status = Column(String(20), nullable=True)     # success, failure
  ip_address = Column(String(50), nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
