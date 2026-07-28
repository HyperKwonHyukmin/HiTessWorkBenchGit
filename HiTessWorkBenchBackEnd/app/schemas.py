from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class LoginRequest(BaseModel):
    employee_id: str


class UserCreate(BaseModel):
    employee_id: str
    name: str
    company: str
    department: str
    position: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: str
    name: str
    company: str
    department: Optional[str] = None
    position: str
    is_active: bool = False
    is_admin: bool = False
    login_count: int
    last_login: Optional[datetime] = None
    created_at: Optional[datetime] = None
    token: Optional[str] = None


class NoticeCreate(BaseModel):
    type: str
    title: str
    content: str
    is_pinned: bool = False
    is_private: bool = False
    author_id: str
    author_name: Optional[str] = None
    app_key: Optional[str] = None
    show_on_entry: bool = False
    publish_status: str = "published"
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None


class NoticeResponse(NoticeCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    revision: int = 1
    created_at: datetime


class FeatureRequestCreate(BaseModel):
    title: str
    content: str
    author_id: str
    author_name: str
    app_key: Optional[str] = None


class FeatureRequestUpdate(BaseModel):
    title: str
    content: str


class FeatureRequestResponse(FeatureRequestCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    upvotes: int
    comments_count: int
    admin_comment: Optional[str] = None
    created_at: datetime
    # 요청 사용자가 이미 추천했는지 여부(앱 스코프 목록에서만 채워지며 그 외에는 False).
    upvoted_by_me: bool = False


class FeatureRequestComment(BaseModel):
    status: str
    admin_comment: str


class AppSpaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    app_key: str
    display_name: str
    notice_enabled: bool
    board_enabled: bool
    is_active: bool


class AppSpaceCreate(BaseModel):
    app_key: str
    display_name: str
    notice_enabled: bool = True
    board_enabled: bool = True
    is_active: bool = True


class AppSpaceUpdate(BaseModel):
    # 부분 갱신(PATCH 성) — 전달된 필드만 반영한다.
    display_name: Optional[str] = None
    notice_enabled: Optional[bool] = None
    board_enabled: Optional[bool] = None
    is_active: Optional[bool] = None


class AppSpaceAdminResponse(BaseModel):
    """관리자 App 커뮤니티 관리용 — 공지/게시글 집계를 함께 제공한다."""

    model_config = ConfigDict(from_attributes=True)

    app_key: str
    display_name: str
    notice_enabled: bool
    board_enabled: bool
    is_active: bool
    created_at: Optional[datetime] = None
    notice_count: int = 0
    request_count: int = 0


class AppSettingResponse(BaseModel):
    """App별 관리자 오버라이드. None 필드는 '오버라이드 없음'(코드 기본값 사용)."""

    model_config = ConfigDict(from_attributes=True)

    app_key: str
    dev_status: Optional[str] = None
    maintenance: bool = False
    maintenance_message: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    contributor: Optional[str] = None
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None


class AppSettingUpdate(BaseModel):
    """부분 갱신 — 요청에 담긴 필드만 반영한다(model_dump(exclude_unset=True)).

    필드를 명시적으로 null 로 보내면 해당 오버라이드를 해제해 코드 기본값으로
    되돌린다. 아예 보내지 않으면 기존 값을 유지한다.
    """

    dev_status: Optional[str] = None
    maintenance: Optional[bool] = None
    maintenance_message: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    contributor: Optional[str] = None


class UserGuideCreate(BaseModel):
    category: str
    title: str
    content: str
    author_id: str


class UserGuideResponse(UserGuideCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
