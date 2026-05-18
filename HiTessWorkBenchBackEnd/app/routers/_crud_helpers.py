"""
지원 게시판/사용자/런북 라우터들이 공통으로 반복하던 CRUD 패턴 헬퍼.

흡수한 패턴:
  - db.query(Model).filter(Model.id == id).first() → None 체크 → 404
  - db.add(instance) + db.commit() + db.refresh(instance)
  - setattr 루프 + db.commit() + db.refresh(instance)
  - db.delete(instance) + db.commit() + {"message": "Deleted"}

원칙:
  - 헬퍼는 작고 명시적이다. 호출부가 모델 인스턴스를 직접 만들어 전달하는 등
    제어권을 유지한다 (수정 후 추가 비즈니스 로직 가능).
  - 응답 dict 구조는 라우터별로 다를 수 있으므로, update/delete 헬퍼는
    instance 또는 표준 dict 만 반환하고 응답 포맷은 호출부가 결정한다.
"""
from typing import Optional, Type, TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Session

T = TypeVar("T")


def get_or_404(db: Session, model_class: Type[T], record_id: int, not_found_msg: str) -> T:
    """주어진 id 의 레코드를 조회하고, 없으면 HTTPException 404 를 발생시킨다.

    not_found_msg 로 라우터별 한/영 메시지를 보존한다 (예: "공지사항을 찾을 수 없습니다.",
    "User not found").
    """
    record = db.query(model_class).filter(model_class.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail=not_found_msg)
    return record


def create_record(db: Session, instance):
    """모델 인스턴스를 받아 add → commit → refresh 한 뒤 반환한다.

    호출부가 schema 를 모델로 변환해서 전달:
        new_notice = models.Notice(**notice.model_dump())
        return create_record(db, new_notice)
    """
    db.add(instance)
    db.commit()
    db.refresh(instance)
    return instance


def update_record(db: Session, instance, payload: dict, allowed_fields: Optional[set] = None):
    """instance 의 필드를 payload dict 로 갱신한 뒤 commit + refresh 한다.

    - allowed_fields 가 None 이면 payload 의 모든 키를 그대로 적용 (Pydantic 스키마
      가 이미 입력을 화이트리스트로 좁히는 경우).
    - allowed_fields 가 set 이면 화이트리스트 외 키는 무시 (users.py 처럼 dict 를
      그대로 받는 케이스에서 임의 필드 주입을 차단).
    """
    for key, value in payload.items():
        if allowed_fields is not None and key not in allowed_fields:
            continue
        setattr(instance, key, value)
    db.commit()
    db.refresh(instance)
    return instance


def delete_record(db: Session, instance, message: str = "Deleted") -> dict:
    """instance 를 삭제하고 표준 응답 dict {"message": ...} 를 반환한다.

    message 로 "User deleted" 등 라우터별 문구를 보존할 수 있다.
    """
    db.delete(instance)
    db.commit()
    return {"message": message}
