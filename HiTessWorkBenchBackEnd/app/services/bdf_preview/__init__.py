"""All Projects BDF 3D 미리보기 — BDF 를 브라우저 뷰어용 model.lbm(gzip 바이너리)으로 바꾼다.

⚠ deck.py · fields.py · coords.py · model.py · lbm.py 는 Hi-TESS LogBook `backend/app/bdf/` 의 **무수정 사본**이다
(원본 커밋 ea85601, 2026-10-15, LBM 형식 v2). 여기서 고치지 말 것 — LogBook 에서 고친 뒤 다시 복사한다.
프런트 뷰어(`frontend/src/components/bdfPreview/`)도 LogBook 사본이라 lbm 형식 버전이 서로 맞아야 한다.
WorkBench 쪽 코드는 service.py 하나뿐이다.
"""
