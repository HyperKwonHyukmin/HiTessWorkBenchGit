from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
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
  # 사내 PLM(HIPLM.VT_PLM_USER)에서 사번으로 조회해 백필한다. 사용자가 가입 폼에서
  # 입력하지 않으며, 조회 실패/미등록 사번이면 NULL 로 둔다.
  email = Column(String(255), nullable=True)
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


class AccessSession(Base):
  """접속 이력 — 로그인부터 앱을 닫을 때까지 1행. 하트비트(45초)마다 갱신된다.

  user_presence 는 '지금' 상태만 덮어쓰고 지워지지만, 이 테이블은 끝난 세션도 남긴다.
  activity_logs(30일 삭제)와 달리 기간 제한 없이 보관하는 장기 사용 기록이다.
  - online_seconds : 앱이 열려 있던 시간(하트비트 간격 합)
  - active_seconds : 그중 유휴(3분 무입력)가 아니던 시간
  - page_seconds   : {메뉴명: 활성 시간(초)} — 어느 화면에서 일했는지
  - end_reason     : logout | closed(창 닫음) | forced(관리자) | relogin | timeout(하트비트 끊김)
  """

  __tablename__ = "access_sessions"
  id = Column(Integer, primary_key=True, index=True)
  employee_id = Column(String(50), nullable=False, index=True)
  started_at = Column(DateTime, nullable=False, default=datetime.now, index=True)
  last_seen_at = Column(DateTime, nullable=False, default=datetime.now)
  ended_at = Column(DateTime, nullable=True)
  end_reason = Column(String(20), nullable=True)
  ip = Column(String(50), nullable=True)
  app_version = Column(String(30), nullable=True)
  hostname = Column(String(100), nullable=True)
  os_user = Column(String(100), nullable=True)
  platform = Column(String(50), nullable=True)
  heartbeat_count = Column(Integer, nullable=False, default=0)
  online_seconds = Column(Integer, nullable=False, default=0)
  active_seconds = Column(Integer, nullable=False, default=0)
  last_page = Column(String(200), nullable=True)
  page_seconds = Column(JSON, nullable=True)


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
  # 작업이 Success/Failed/Cancelled 로 끝난 시각. 소요시간 = finished_at - started_at.
  # 이 컬럼 도입 전 기록과 서버 재시작으로 Interrupted 된 기록은 NULL 이다.
  finished_at = Column(DateTime(timezone=True), nullable=True)
  # Plan B — 결과 파일 보관 정책. 판정 우선순위: pinned > retain_until > 폴더 나이(30일).
  # retain_until 은 연장된 만료 시각(없으면 폴더 생성+30일 규칙), pinned=True 면 자동 삭제 제외.
  # created_at 과 마찬가지로 naive datetime 으로 비교한다(라우터 replace(tzinfo=None) 패턴).
  retain_until = Column(DateTime(timezone=True), nullable=True)
  pinned = Column(Boolean, default=False, nullable=False)


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
  # 카탈로그 카드의 분류·그림(utils/cardArt.js 이름). NULL = 코드 기본값.
  category = Column(String(40), nullable=True)
  art = Column(String(20), nullable=True)
  # 외부 앱(백엔드 프록시로 여는 타 개발자 웹앱)의 접속 주소. NULL = 코드 기본값.
  external_host = Column(String(253), nullable=True)
  external_port = Column(Integer, nullable=True)
  updated_by = Column(String(50), nullable=True)
  updated_at = Column(
      DateTime(timezone=True),
      default=datetime.now,
      onupdate=datetime.now,
  )


class ExternalAppRegistration(Base):
  """관리자가 App Settings 에서 등록한 외부 앱(코드 수정 없이 만든 입구).

  코드에 박힌 외부 앱(Block Weld 등)과 달리 행 하나가 곧 앱 하나다 —
  카탈로그 카드·실행 페이지·프록시(/external-apps/<slug>)가 모두 이 행에서 나온다.
  서비스 상태·점검 안내는 다른 앱처럼 app_settings(app_key=title)로 덮을 수 있다.
  """

  __tablename__ = "external_app_registrations"
  id = Column(Integer, primary_key=True, index=True)
  slug = Column(String(40), unique=True, nullable=False, index=True)  # 주소 이름, 생성 후 변경 불가
  title = Column(String(200), unique=True, nullable=False)  # 카탈로그 제목 = app_settings app_key
  description = Column(String(1000), nullable=True)
  mode = Column(String(20), nullable=False, default="Interactive")
  category = Column(String(40), nullable=False)
  art = Column(String(20), nullable=True)
  tags = Column(JSON, nullable=True)
  contributor = Column(String(100), nullable=True)
  dev_status = Column(String(20), nullable=False, default="Active")
  host = Column(String(253), nullable=False)
  port = Column(Integer, nullable=False)
  created_by = Column(String(50), nullable=True)
  created_at = Column(DateTime(timezone=True), default=datetime.now)
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


class Notification(Base):
  """사용자별 인앱 알림(알림 센터). 서버가 남기고 클라이언트가 30초 폴링으로 가져간다.

  - employee_id : 수신자 사번
  - kind        : notification_service.NOTIFICATION_KINDS 어휘(job.completed 등)
  - link        : {"menu": <NavigationContext 메뉴명>, "params": {...}} — 클릭 시 이동처
  - dedupe_key  : 같은 키의 미읽음 알림이 있으면 새로 만들지 않는다(만료 경고를 매일 돌려도 1건)
  - read_at     : NULL = 미읽음
  보관은 cleanup_service 가 90일(NOTIFICATION_RETENTION_DAYS) 로 정리한다.
  """

  __tablename__ = "notifications"
  id = Column(Integer, primary_key=True, index=True)
  employee_id = Column(String(50), nullable=False, index=True)
  kind = Column(String(50), nullable=False)
  title = Column(String(200), nullable=False)
  body = Column(String(1000), nullable=False, default="")
  link = Column(JSON, nullable=True)
  dedupe_key = Column(String(200), nullable=True, index=True)
  read_at = Column(DateTime, nullable=True)
  created_at = Column(DateTime, default=datetime.now, index=True)


class UserPreference(Base):
  """사용자 환경설정(즐겨찾기·최근 앱·알림 설정·시작 메뉴) — 소유는 Plan E.

  마스터 설계 §2.2 정의 그대로다. 알림 센터(Plan A)는 prefs["notifications"] 를
  {"muted_kinds": [...], "desktop_toast": bool} 로 읽기만 하고, 쓰기 엔드포인트
  (GET/PUT /api/preferences)는 Plan E 가 만든다. Plan E 는 이 클래스가 이미 있으면 건너뛴다.
  """

  __tablename__ = "user_preferences"
  employee_id = Column(String(50), primary_key=True)
  prefs = Column(JSON, nullable=False, default=dict)
  updated_at = Column(DateTime, nullable=True)


class DiagnosticSignature(Base):
  """해석 오류·경고의 '유형' 1건 — 같은 지문(fingerprint)이면 발생 횟수만 늘린다.

  작업이 끝날 때(analysis_runner.mark_complete) services/nastran_diagnostics 가 F06 FATAL/WARNING 과
  Nastran 전 단계 실패(엔진 로그)를 모아 여기에 쌓는다. userConnection 은 30일 뒤 지워지지만 이 표와
  DiagnosticsArchive/ 의 재현 자료는 남는다 — 반복되는 오류를 코드로 막아 가는 근거 자료다.

  - fingerprint : level + code + 정규화한 메시지(숫자·ID·경로 제거)의 해시
  - level       : fatal | warning | engine(Nastran 전 단계 실패)
  - status      : new(미처리) | handled(코드로 대응함) | ignored(대응 안 함) | regressed(처리 후 재발)
  - archive_dir : 처음 발생(그리고 재발) 때 보관한 재현 자료 폴더(DiagnosticsArchive 기준 상대 경로)
  """

  __tablename__ = "diagnostic_signatures"
  id = Column(Integer, primary_key=True, index=True)
  fingerprint = Column(String(40), unique=True, index=True, nullable=False)
  level = Column(String(20), index=True, nullable=False)
  code = Column(String(20), index=True, nullable=True)
  template = Column(String(1000), nullable=False)
  sample_message = Column(Text, nullable=True)
  programs = Column(JSON, nullable=True)            # 발생한 program_name 목록
  occurrence_count = Column(Integer, default=0, nullable=False)
  first_seen = Column(DateTime, default=datetime.now, index=True)
  last_seen = Column(DateTime, default=datetime.now, index=True)
  status = Column(String(20), default="new", index=True, nullable=False)
  handled_note = Column(Text, nullable=True)        # 무엇으로 대응했는지(규칙·커밋·버전)
  handled_at = Column(DateTime, nullable=True)
  archive_dir = Column(String(500), nullable=True)


class DiagnosticOccurrence(Base):
  """DiagnosticSignature 가 실제로 난 해석 1건(어느 App·누구·어느 기록)."""

  __tablename__ = "diagnostic_occurrences"
  id = Column(Integer, primary_key=True, index=True)
  signature_id = Column(Integer, ForeignKey("diagnostic_signatures.id"), index=True, nullable=False)
  analysis_id = Column(Integer, index=True, nullable=True)
  job_id = Column(String(100), index=True, nullable=True)
  program_name = Column(String(100), index=True, nullable=True)
  employee_id = Column(String(50), index=True, nullable=True)
  analysis_status = Column(String(20), nullable=True)
  source_file = Column(String(500), nullable=True)  # 오류가 난 F06/입력 경로(30일 뒤엔 사라질 수 있음)
  message = Column(Text, nullable=True)             # 이 발생의 원문 메시지
  archived = Column(Boolean, default=False, nullable=False)
  created_at = Column(DateTime, default=datetime.now, index=True)


class LogbookExport(Base):
  """관리자가 All Projects 에서 해석 1건의 파일을 Hi-TESS LogBook 으로 보낸 기록.

  LogBook 쪽에는 보낸 관리자 이름의 '정리 대기' 묶음(batch_key)이 생긴다. 목록의 'LogBook 보냄' 표시와
  상세 창의 보낸 이력에 쓴다. 실패한 시도도 남긴다(state='failed', error).
  """

  __tablename__ = "logbook_exports"
  id = Column(Integer, primary_key=True, index=True)
  analysis_id = Column(Integer, index=True, nullable=False)
  sent_by = Column(String(50), index=True, nullable=False)
  batch_key = Column(String(40), nullable=True)
  state = Column(String(20), nullable=False, default="staged")   # staged | blocked | failed
  title = Column(String(255), nullable=True)
  note = Column(Text, nullable=True)
  file_count = Column(Integer, default=0, nullable=False)
  total_bytes = Column(BigInteger, default=0, nullable=False)
  blocked = Column(JSON, nullable=True)   # LogBook 에 이미 같은 BDF 가 있어 받지 않은 파일
  rejected = Column(JSON, nullable=True)  # DRM 등으로 보내지 못한 파일
  error = Column(Text, nullable=True)
  created_at = Column(DateTime, default=datetime.now, index=True)
