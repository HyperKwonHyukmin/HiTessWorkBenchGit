"""
User Guide 기본 콘텐츠를 DB에 직접 삽입하는 스탠드얼론 스크립트.

사용법 (HiTessWorkBenchBackEnd/ 디렉터리에서 실행):
  python insert_guides.py          -- 새 가이드만 추가 (title 중복 건너뜀)
  python insert_guides.py --force  -- 전체 삭제 후 재삽입
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal, engine
from app import models
from app.seed_guides import seed_default_guides, DEFAULT_GUIDES

models.Base.metadata.create_all(bind=engine)

force = "--force" in sys.argv

db = SessionLocal()
try:
    if force:
        deleted = db.query(models.UserGuide).delete()
        db.commit()
        print(f"Deleted {deleted} existing guides.")

    count_before = db.query(models.UserGuide).count()
    seed_default_guides(db)
    count_after = db.query(models.UserGuide).count()
    inserted = count_after - count_before

    if inserted > 0:
        print(f"Inserted {inserted} guides. (Total: {count_after})")
    else:
        print(f"No new guides to insert. (Total: {count_after}). Use --force to re-insert all.")
finally:
    db.close()
