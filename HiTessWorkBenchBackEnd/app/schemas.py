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


class UserGuideCreate(BaseModel):
    category: str
    title: str
    content: str
    author_id: str


class UserGuideResponse(UserGuideCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
