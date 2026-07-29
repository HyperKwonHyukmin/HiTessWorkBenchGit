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
  # '내게서만 삭제' — 각 당사자가 자기 화면에서만 대화를 숨긴 여부(상대 기록은 보존).
  hidden_by_sender = Column(Boolean, default=False, nullable=False)
  hidden_by_recipient = Column(Boolean, default=False, nullable=False)


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


class AppSetting(Base):
  """관리자가 App별로 관리하는 서비스 상태·점검 안내·표시 메타데이터.

  앱 카탈로그의 원본은 여전히 프론트엔드 코드(ANALYSIS_DATA)이고, 이 테이블은
  그 위에 덮는 '오버라이드'만 담는다. 행이 없으면 코드 기본값이 그대로 쓰이며,
  행을 지우면 코드 기본값으로 되돌아간다(= 초기화). 덕분에 코드에 앱을 새로
  추가해도 DB 행을 미리 만들 필요가 없다.

  NULL 컬럼은 '오버라이드 없음'을 뜻한다(빈 문자열과 구분).
  """

  __tablename__ = "app_settings"
  app_key = Column(String(200), primary_key=True)  # ANALYSIS_DATA 의 title
  dev_status = Column(String(20), nullable=True)  # Active/Developing/Planned
  maintenance = Column(Boolean, default=False, nullable=False)
  maintenance_message = Column(String(500), nullable=True)
  description = Column(String(1000), nullable=True)
  tags = Column(JSON, nullable=True)
  contributor = Column(String(100), nullable=True)
  updated_by = Column(String(50), nullable=True)
  updated_at = Column(
      DateTime(timezone=True),
      default=datetime.now,
      onupdate=datetime.now,
  )


class ActivityLog(Base):
  __tablename__ = "activity_logs"
  id = Column(Integer, primary_key=True, index=True)
  employee_id = Column(String(50), index=True, nullable=True)
  action_type = Column(String(50), index=True)
  action_detail = Column(JSON, nullable=True)
  status = Column(String(20), nullable=True)
  ip_address = Column(String(50), nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class RegisteredModel(Base):
  """관리자가 선별해 Model Library에 영구 등록한 BDF 모델의 논리 단위.

  userConnection/ 은 30일 뒤 삭제되므로(cleanup_service.RETENTION_DAYS), 가치 있는
  모델은 이 registry를 통해 registry root로 복사되어 영구 보관된다.

  이 테이블은 '모델' 자체의 사용자 메타데이터만 담고, 실제 파일/요약/체크섬은
  RegisteredModelRevision(불변 스냅샷)과 RegisteredModelArtifact(파일)에 있다.
  제목·태그·설명 변경은 새 revision을 만들지 않는다.
  """

  __tablename__ = "registered_models"
  id = Column(Integer, primary_key=True, index=True)
  model_uid = Column(String(36), unique=True, index=True, nullable=False)  # 외부 노출용 UUID
  title = Column(String(200), nullable=False)
  description = Column(Text, nullable=True)
  model_type = Column(String(100), index=True, nullable=True)   # module-unit, beam-frame 등
  model_role = Column(String(30), index=True, nullable=True)    # reference/notable/failure/before/after
  confidence = Column(String(20), nullable=True)                # high/medium/review-required
  reuse_notes = Column(Text, nullable=True)
  # 기본 company: 관리자가 선별한 기준 모델을 팀 전체가 참조하는 것이 이 기능의 목적.
  visibility = Column(String(20), index=True, default="company", nullable=False)
  tags = Column(JSON, nullable=True)
  # owner_id = source Analysis 를 수행한 원 엔지니어(출처 보존). registered_by = 등록한 관리자.
  owner_id = Column(String(50), index=True, nullable=True)
  registered_by = Column(String(50), index=True, nullable=True)
  status = Column(String(20), index=True, default="active", nullable=False)  # active/archived
  created_at = Column(DateTime(timezone=True), server_default=func.now())
  updated_at = Column(
      DateTime(timezone=True),
      default=datetime.now,
      onupdate=datetime.now,
  )


class RegisteredModelRevision(Base):
  """등록 시점의 불변 스냅샷. artifact나 자동 추출 summary가 바뀌면 새 revision이다.

  source_analysis_id 는 의도적으로 ForeignKey 가 아니다 — Analysis 이력이 정리되어도
  등록된 모델은 남아야 하며, cascade 삭제로 registry가 지워지면 안 된다.
  """

  __tablename__ = "registered_model_revisions"
  __table_args__ = (
      UniqueConstraint("model_id", "revision_no", name="uq_registry_model_rev"),
  )

  id = Column(Integer, primary_key=True, index=True)
  model_id = Column(
      Integer,
      ForeignKey("registered_models.id", ondelete="CASCADE"),
      nullable=False,
      index=True,
  )
  revision_no = Column(Integer, nullable=False)          # model별 1부터 증가
  schema_version = Column(String(20), nullable=False)    # summary contract version

  # provenance — FK 없이 보관(위 docstring 참조)
  source_analysis_id = Column(Integer, nullable=True, index=True)
  source_program_name = Column(String(100), index=True, nullable=True)
  source_artifact_kind = Column(String(50), index=True, nullable=True)

  bdf_sha256 = Column(String(64), unique=True, index=True, nullable=False)
  storage_relative_path = Column(String(500), nullable=False)  # registry root 기준 상대경로
  summary_json = Column(JSON, nullable=True)
  artifact_manifest = Column(JSON, nullable=True)

  # 모델 품질(파싱·연결성·solver health)과 설계 결과(pass/fail)는 별개 축이다.
  # 응력 초과 모델도 정확히 표현되었다면 고품질 회귀 예제일 수 있다.
  quality_level = Column(String(10), index=True, nullable=True)   # Q0~Q4
  review_status = Column(String(30), index=True, default="unreviewed", nullable=True)
  design_outcome = Column(String(30), index=True, default="unknown", nullable=True)

  # 자주 조회하는 scalar — 상세 breakdown은 summary_json 에서 읽는다.
  # 소스에 값이 없으면 NULL 이다. 0 으로 대체하지 않는다.
  node_count = Column(Integer, nullable=True)
  element_count = Column(Integer, nullable=True)
  total_mass_kg = Column(Float, nullable=True)
  max_utilization = Column(Float, nullable=True)

  created_at = Column(DateTime(timezone=True), server_default=func.now())


class RegisteredModelArtifact(Base):
  """revision 폴더 안에 실제로 보관된 파일 1개. 다운로드 API가 받는 유일한 식별자는 id다.

  relative_path 는 registry root 기준 상대경로만 저장한다(절대/UNC 경로 노출 금지).
  """

  __tablename__ = "registered_model_artifacts"
  id = Column(Integer, primary_key=True, index=True)
  revision_id = Column(
      Integer,
      ForeignKey("registered_model_revisions.id", ondelete="CASCADE"),
      nullable=False,
      index=True,
  )
  kind = Column(String(50), index=True, nullable=False)   # bdf/summary/validation/f06/op2 등
  file_name = Column(String(255), nullable=False)         # 표시용 basename
  relative_path = Column(String(500), nullable=False)
  size_bytes = Column(Integer, nullable=True)
  sha256 = Column(String(64), nullable=True)
  media_type = Column(String(100), nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now())
