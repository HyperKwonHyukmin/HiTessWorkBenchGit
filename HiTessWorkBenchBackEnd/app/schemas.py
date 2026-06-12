from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# ==========================================
# 1. User (사용자 계정) 스키마
# ==========================================
class LoginRequest(BaseModel):
    employee_id: str

class UserCreate(BaseModel):
    employee_id: str
    name: str
    company: str
    department: str
    position: str

class UserResponse(BaseModel):
    id: int
    employee_id: str
    name: str
    company: str
    department: Optional[str] = None
    position: str
    is_active: bool = False  # 승인 여부
    is_admin: bool = False   # 관리자 여부
    login_count: int
    last_login: Optional[datetime] = None
    created_at: Optional[datetime] = None
    token: Optional[str] = None  # 로그인 성공 시 세션 토큰

    class Config:
      from_attributes = True


# ==========================================
# 2. Notice & Updates (공지사항) 스키마
# ==========================================
class NoticeCreate(BaseModel):
    type: str
    title: str
    content: str
    is_pinned: bool
    is_private: bool = False
    author_id: str
    author_name: Optional[str] = None

class NoticeResponse(NoticeCreate):
    id: int
    created_at: datetime

    class Config:
        orm_mode = True


# ==========================================
# 3. Feature Request (기능 요청 및 피드백) 스키마
# ==========================================
class FeatureRequestCreate(BaseModel):
    title: str
    content: str
    author_id: str
    author_name: str

class FeatureRequestResponse(FeatureRequestCreate):
    id: int
    status: str
    upvotes: int
    comments_count: int
    admin_comment: Optional[str] = None  # 관리자 피드백 댓글
    created_at: datetime

    class Config:
        orm_mode = True

class FeatureRequestComment(BaseModel):
    """관리자가 기능 요청에 답변을 달 때 사용하는 스키마"""
    status: str
    admin_comment: str


# ==========================================
# 4. User Guide (사용자 가이드) 스키마
# ==========================================
class UserGuideCreate(BaseModel):
    category: str
    title: str
    content: str
    author_id: str

class UserGuideResponse(UserGuideCreate):
    id: int
    created_at: datetime

    class Config:
        orm_mode = True


# ==========================================
# 5. Newsletter (뉴스레터 아카이브) 스키마
# ==========================================
# 업로드는 multipart(Form + File)로 받으므로 Create 바디 스키마는 두지 않는다.
class NewsletterResponse(BaseModel):
    id: int
    title: str
    issue_date: Optional[datetime] = None
    description: Optional[str] = None
    file_name: str            # 다운로드용 표시 파일명 (실제 저장명 stored_name 은 노출하지 않음)
    author_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
