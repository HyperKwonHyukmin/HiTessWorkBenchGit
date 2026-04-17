"""
일회성 마이그레이션: position 필드의 '책임 엔지니어' → '책임엔지니어'
실행: python migrate_position.py  (HiTessWorkBenchBackEnd/ 디렉토리에서)
"""
from app.database import SessionLocal
from app import models

def run():
    db = SessionLocal()
    try:
        targets = db.query(models.User).filter(
            models.User.position == '책임 엔지니어'
        ).all()
        count = len(targets)
        if count == 0:
            print("변경 대상 없음 — 이미 모두 '책임엔지니어' 형식입니다.")
            return
        for u in targets:
            u.position = '책임엔지니어'
        db.commit()
        print(f"✅ {count}명의 직급이 '책임엔지니어'로 변경되었습니다.")
    except Exception as e:
        db.rollback()
        print(f"❌ 오류 발생: {e}")
    finally:
        db.close()

if __name__ == '__main__':
    run()
