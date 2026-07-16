from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from .database import Base


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
  token = Column(String(36), primary_key=True)
  employee_id = Column(String(50), nullable=False, index=True)
  created_at = Column(DateTime, default=datetime.now)
  expires_at = Column(DateTime, nullable=False)


class UserPresence(Base):
  """클라이언트 하트비트로 갱신되는 사용자별 실시간 접속 상태."""

  __tablename__ = "user_presence"
  employee_id = Column(String(50), primary_key=True)
  last_seen = Column(DateTime, default=datetime.now, index=True)
  last_ip = Column(String(50), nullable=True)
  last_page = Column(String(200), nullable=True)
  session_started = Column(DateTime, nullable=True)
  last_active_at = Column(DateTime, nullable=True)
  app_version = Column(String(30), nullable=True)


class ChatMessage(Base):
  """관리자↔사용자 1:1 DM 메시지. 양측 중 최소 1명은 관리자다(peer-to-peer 금지).

  - sender_id / recipient_id : 사번(대문자 정규화)
  - read_at                  : 수신자가 대화를 열람한 시각(미읽음 판정용, null=미읽음)
  """

  __tablename__ = "chat_messages"
  id = Column(Integer, primary_key=True, index=True)
  sender_id = Column(String(50), nullable=False, index=True)
  recipient_id = Column(String(50), nullable=False, index=True)
  body = Column(Text, nullable=False)
  created_at = Column(DateTime, default=datetime.now, index=True)
  read_at = Column(DateTime, nullable=True)


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
  source = Column(String(50), default="Workbench")
  created_at = Column(DateTime(timezone=True), server_default=func.now())
  started_at = Column(DateTime(timezone=True), nullable=True)
  updated_at = Column(DateTime(timezone=True), nullable=True)


class AppSpace(Base):
  """공지·요청 기능을 명시적으로 활성화한 WorkBench App."""

  __tablename__ = "app_spaces"
  app_key = Column(String(100), primary_key=True)
  display_name = Column(String(200), nullable=False)
  notice_enabled = Column(Boolean, default=True, nullable=False)
  board_enabled = Column(Boolean, default=True, nullable=False)
  is_active = Column(Boolean, default=True, nullable=False)
  created_at = Column(DateTime(timezone=True), default=datetime.now)


class Notice(Base):
  __tablename__ = "notices"
  id = Column(Integer, primary_key=True, index=True)
  app_key = Column(String(100), nullable=True, index=True)
  type = Column(String(50))
  title = Column(String(200))
  content = Column(String(2000))
  is_pinned = Column(Boolean, default=False)
  is_private = Column(Boolean, default=False)
  show_on_entry = Column(Boolean, default=False)
  publish_status = Column(String(20), default="published")
  starts_at = Column(DateTime(timezone=True), nullable=True)
  ends_at = Column(DateTime(timezone=True), nullable=True)
  revision = Column(Integer, default=1, nullable=False)
  author_id = Column(String(50))
  author_name = Column(String(50), nullable=True)
  created_at = Column(DateTime(timezone=True), default=datetime.now)


class AppNoticeRead(Base):
  """사용자별 App 진입 공지 확인 기록. 공지 revision마다 한 번 저장한다."""

  __tablename__ = "app_notice_reads"
  __table_args__ = (
      UniqueConstraint(
          "notice_id",
          "employee_id",
          "notice_revision",
          name="uq_app_notice_read_revision",
      ),
  )

  id = Column(Integer, primary_key=True, index=True)
  notice_id = Column(
      Integer,
      ForeignKey("notices.id", ondelete="CASCADE"),
      nullable=False,
      index=True,
  )
  employee_id = Column(String(50), nullable=False, index=True)
  notice_revision = Column(Integer, nullable=False)
  acknowledged_at = Column(DateTime(timezone=True), default=datetime.now)


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
  app_key = Column(String(100), nullable=True, index=True)
  title = Column(String(200))
  content = Column(String(5000))
  status = Column(String(50), default="Under Review")
  upvotes = Column(Integer, default=0)
  comments_count = Column(Integer, default=0)
  author_id = Column(String(50))
  author_name = Column(String(50))
  admin_comment = Column(String(5000), nullable=True)
  created_at = Column(DateTime(timezone=True), default=datetime.now)


class FeatureRequestUpvote(Base):
  """사용자별 기능요청 추천 기록. (request_id, employee_id) 당 한 번만 추천 가능."""

  __tablename__ = "feature_request_upvotes"
  __table_args__ = (
      UniqueConstraint(
          "request_id",
          "employee_id",
          name="uq_feature_request_upvote",
      ),
  )

  id = Column(Integer, primary_key=True, index=True)
  request_id = Column(
      Integer,
      ForeignKey("feature_requests.id", ondelete="CASCADE"),
      nullable=False,
      index=True,
  )
  employee_id = Column(String(50), nullable=False, index=True)
  created_at = Column(DateTime(timezone=True), default=datetime.now)


class ActivityLog(Base):
  __tablename__ = "activity_logs"
  id = Column(Integer, primary_key=True, index=True)
  employee_id = Column(String(50), index=True, nullable=True)
  action_type = Column(String(50), index=True)
  action_detail = Column(JSON, nullable=True)
  status = Column(String(20), nullable=True)
  ip_address = Column(String(50), nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
