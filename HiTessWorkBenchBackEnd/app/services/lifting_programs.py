"""권상 해석 부모 App 이름 (2026-11-17).

Studio 권상 흐름(업로드 → 자세안정성 → Unit 구조 해석)을 쓰는 부모 레코드의 program_name.
업로드, deck-fix, 산출물, lifting-bdf, unit-structural 라우트와 unit_structural_service 가 이 목록으로 부모를 확인한다.
TrussModuleLifting 은 Truss 소모듈 권상(계획 docs/plans/2026-11-17-truss-module-lifting-plan.md) — 구조 해석 뒤
소모듈 평가 exe(TrussModuleAssessment)를 더 돌린다(unit_structural_service).
"""
LIFTING_PARENT_PROGRAMS: tuple[str, ...] = ("GroupModuleUnit", "SidePassage", "TrussModuleLifting")
TRUSS_LIFTING_PROGRAM = "TrussModuleLifting"
