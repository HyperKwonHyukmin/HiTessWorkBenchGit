"""Canonical metadata for programs recorded in the Analysis table.

The registry is deliberately additive: services continue to persist their existing
``program_name`` values.  It only gives read-side features (statistics, passports,
and rerun dispatch) one immutable place to understand historical aliases.
"""
from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Final


# 계산서(리포트) 대상 여부. 세 상태가 필요하다 — '아직 없음'과 '원래 대상 아님'은
# 다른 사실이고, 화면이 같은 문구로 덮으면 사용자가 잘못 이해한다.
#   supported      : 계산서를 만든다
#   planned        : 판정을 내는 해석이지만 결과 본문에 아직 닿지 못한다(전용 어댑터 대기)
#   not-applicable : 모델 생성·전처리·내부 단계라 애초에 계산서 대상이 아니다
REPORT_SCOPES: Final = frozenset({"supported", "planned", "not-applicable"})

# 이 App 이 종합 판정을 내는가.
#   required : 판정이 나와야 정상. 비어 있으면 '확인 필요' 라는 진짜 경고가 된다.
#   none     : 허용하중·단면 특성처럼 합격/불합격을 내지 않는다 → 판정 칸 자체를 안 만든다.
# ⚠️ 기본값은 required 다. 새 App 을 등록하며 깜빡했을 때 판정 칸이 조용히 사라지는
#    것보다, 눈에 보이는 '확인 필요' 가 뜨는 편이 안전하다.
VERDICT_KINDS: Final = frozenset({"required", "none"})


@dataclass(frozen=True, slots=True)
class ProgramSpec:
    program_id: str
    display_name: str
    aliases: tuple[str, ...]
    capabilities: frozenset[str]
    history_visible: bool = True
    rerun_adapter: str | None = None
    input_keys: tuple[str, ...] = ()
    statistics_group: str | None = None
    report_adapter: str | None = None
    report_template: str | None = None
    report_scope: str = "not-applicable"
    verdict_kind: str = "required"

    def __post_init__(self) -> None:
        if not self.program_id or not self.aliases:
            raise ValueError("ProgramSpec requires a program_id and at least one alias")
        if len({alias.casefold() for alias in self.aliases}) != len(self.aliases):
            raise ValueError(f"Duplicate aliases in {self.program_id}")
        if self.report_scope not in REPORT_SCOPES:
            raise ValueError(
                f"Unknown report_scope {self.report_scope!r} in {self.program_id}"
            )
        if self.verdict_kind not in VERDICT_KINDS:
            raise ValueError(
                f"Unknown verdict_kind {self.verdict_kind!r} in {self.program_id}"
            )


def _spec(
    program_id: str,
    display_name: str,
    *aliases: str,
    capabilities: tuple[str, ...] = (),
    history_visible: bool = True,
    rerun_adapter: str | None = None,
    input_keys: tuple[str, ...] = (),
    statistics_group: str | None = None,
    report_adapter: str | None = None,
    report_template: str | None = None,
    report_scope: str = "not-applicable",
    verdict_kind: str = "required",
) -> ProgramSpec:
    # "report" capability 를 손으로 적지 않는다 — report_scope 와 두 출처가 되면
    # 한쪽만 고쳐 놓고 다른 쪽이 옛말을 하는 드리프트가 생긴다. 여기서 파생시킨다.
    derived = (*capabilities, "report") if report_scope == "supported" else capabilities
    return ProgramSpec(
        program_id=program_id,
        display_name=display_name,
        aliases=tuple(dict.fromkeys((display_name, *aliases))),
        capabilities=frozenset(derived),
        history_visible=history_visible,
        rerun_adapter=rerun_adapter,
        input_keys=input_keys,
        statistics_group=statistics_group,
        report_adapter=report_adapter,
        report_template=report_template,
        report_scope=report_scope,
        verdict_kind=verdict_kind,
    )


# Aliases include values currently emitted by backend services plus historical UI
# labels that already appear in rerun/statistics handling.
PROGRAM_SPECS: Final[tuple[ProgramSpec, ...]] = (
    _spec(
        "truss-model-builder", "TrussModelBuilder", "Truss Model Builder",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="truss",
        input_keys=("node_csv", "member_csv"),
    ),
    _spec(
        "truss-assessment", "Truss Assessment", "Truss Structural Assessment",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="truss-assessment",
        input_keys=("bdf_model",),
        report_adapter="truss-assessment",
        report_scope="supported",
    ),
    _spec(
        "bdf-scanner", "BDF Scanner", "BdfScanner",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="bdf-scanner",
        input_keys=("bdf_model",),
    ),
    _spec(
        "hp-scr-psa", "HP-SCR PSA", "HP-SCR",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="hp-scr",
        input_keys=("bdf_model",),
        statistics_group="hp-scr",
        report_scope="planned",
    ),
    _spec(
        "hp-scr-por", "HP-SCR POR",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="hp-scr",
        input_keys=("bdf_model",),
        statistics_group="hp-scr",
        report_scope="planned",
    ),
    _spec(
        "f06-parser", "F06 Parser", "F06Parser",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="f06-parser",
        input_keys=("f06_file",),
    ),
    _spec(
        "mooring-fitting", "MooringFitting", "Mooring Fitting Assessment",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="mooring-fitting",
        input_keys=("structure_csv", "load_csv"),
        statistics_group="mooring-fitting",
    ),
    # A solve is a derived sub-operation, not a replay of the original inputs.
    _spec(
        "mooring-fitting-solve", "MooringFittingSolve",
        capabilities=("derived-analysis", "passport"),
        input_keys=("edited_bdf", "bdf_model"),
        statistics_group="mooring-fitting-solve",
        report_scope="planned",
    ),
    # CSV → BDF → Nastran 전체 파이프라인. 성과물이 모델·해석 파일이라 계산서 대상이
    # 아니지만, Success 가 쌓여 있는데 미등록이라 program_id 가 'unknown' 이었다.
    _spec(
        "hitess-modelflow", "HiTessModelFlow", "HiTess ModelFlow",
        capabilities=("file-analysis", "passport"),
        input_keys=("stru_file", "pipe_file", "equip_file"),
        statistics_group="hitess-modelflow",
    ),
    _spec(
        "hitess-model-builder", "HiTessModelBuilder", "HiTESS Model Builder",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="model-builder",
        input_keys=("stru_csv", "pipe_csv", "equip_csv"),
        statistics_group="hitess-model-builder",
    ),
    # Likewise this record represents the solver phase of Model Builder.
    _spec(
        "model-builder-analysis", "ModelBuilderAnalysis",
        capabilities=("derived-analysis", "passport"),
        input_keys=("bdf_model", "edited_bdf"),
        statistics_group="model-builder-analysis",
        report_scope="planned",
    ),
    _spec(
        # "Simple Beam Analyzer" 는 이력에 실제로 저장된 이름이다 — 빠뜨리면
        # resolve_program 이 None 을 돌려주고 program_id 가 'unknown' 이 된다.
        "simple-beam", "Simple Beam Assessment", "Beam Analysis", "Simple Beam Analyzer",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="simple-beam",
        input_keys=("input_json",),
        report_scope="supported",
    ),
    _spec(
        "group-module-unit", "GroupModuleUnit", "Group & Module Unit 권상 구조 해석",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="group-module-unit",
        input_keys=("bdf_model",),
        report_scope="planned",
    ),
    _spec(
        "side-passage", "SidePassage", "Side Passage Assessment",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="side-passage",
        input_keys=("bdf_model",),
        report_scope="planned",
    ),
    _spec(
        "hull-acceleration", "선급 Rule 기반 선체 가속도 Calculation", "HullAcceleration",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="hull-acceleration",
        input_keys=("pdf_file", "constants", "condition_overrides"),
        report_scope="planned",
    ),
    _spec(
        "drawing-to-analysis", "DrawingToAnalysis",
        capabilities=("file-analysis", "passport"),
        input_keys=("drawing_file", "image_file", "bdf_model"),
    ),
    _spec(
        "plate-structure", "PlateStructureAnalysis", "Plate Structure Analysis",
        capabilities=("file-analysis", "passport"),
        input_keys=("input_json", "bdf_model"),
        report_scope="planned",
    ),
    _spec(
        "double-pipe-fuel-line", "DoublePipeFuelLine", "이중관 구조 연료배관 해석",
        capabilities=("file-analysis", "passport"),
        input_keys=("input_csv", "csv_file"),
        report_scope="planned",
    ),
    _spec(
        "independent-tank", "IndependentTank",
        "IndependentTankAssessment", "Independent Tank", "Independent Tank Assessment",
        capabilities=("external-app", "passport"),
    ),
    _spec(
        "block-weld", "BlockWeld",
        "BlockWeldAssessment", "Block Weld", "Block Weld Assessment",
        capabilities=("external-app", "passport"),
    ),
    _spec(
        "heavy-block-lifting", "Heavy Block Lifting Simulation",
        capabilities=("external-app", "passport"),
    ),
    _spec(
        "carling-free", "Carling Free Calculator",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
        report_scope="supported",
    ),
    _spec(
        "carling-optimization", "Carling Design Optimization",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
        report_scope="supported",
    ),
    _spec(
        # 허용 하중을 산출할 뿐 합격/불합격을 내지 않는다 → 판정 칸을 만들지 않는다.
        "column-buckling", "Column Buckling Load Calculator",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
        report_scope="supported",
        verdict_kind="none",
    ),
    _spec(
        "mast-post", "Mast Post Assessment",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
        report_scope="supported",
    ),
    _spec(
        "jib-rest", "Jib Rest Assessment",
        "Jib Rest Assessment (1단)", "Jib Rest Assessment (2단)",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
        report_scope="supported",
    ),
    _spec(
        "d-type-lug", "D Type Lug Assessment",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
        report_scope="supported",
    ),
    _spec(
        "hole-fatigue", "Simplified Hole Fatigue Assessment",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
        report_scope="supported",
    ),
    _spec(
        # 단면 특성(면적·단면2차모멘트 등) 계산이라 판정 대상이 아니다.
        "section-property", "Section Property Calculator",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
        report_scope="supported",
        verdict_kind="none",
    ),
    _spec(
        "module-stability", "ModuleStability",
        capabilities=("internal-substep", "passport"),
        history_visible=False,
        input_keys=("bdf_model",),
    ),
    _spec(
        "module-hoist-optimize", "ModuleHoistOptimize",
        capabilities=("internal-substep", "passport"),
        history_visible=False,
        input_keys=("bdf_model",),
    ),
    _spec(
        "unit-structural-analysis", "UnitStructuralAnalysis",
        capabilities=("internal-substep", "passport"),
        history_visible=False,
        input_keys=("bdf_model",),
    ),
)


def _build_alias_index() -> MappingProxyType:
    index: dict[str, ProgramSpec] = {}
    for spec in PROGRAM_SPECS:
        for alias in spec.aliases:
            key = alias.strip().casefold()
            if key in index:
                raise ValueError(f"Program alias is registered twice: {alias}")
            index[key] = spec
    return MappingProxyType(index)


_BY_ALIAS: Final = _build_alias_index()
_BY_ID: Final = MappingProxyType({spec.program_id: spec for spec in PROGRAM_SPECS})


def resolve_program(name: str | None) -> ProgramSpec | None:
    if not isinstance(name, str):
        return None
    return _BY_ALIAS.get(name.strip().casefold())


def get_program(program_id: str) -> ProgramSpec | None:
    return _BY_ID.get(program_id)


def aliases_for(name: str | None) -> tuple[str, ...]:
    spec = resolve_program(name)
    if not spec:
        return () if not name else (name,)
    # Aliases describe alternate persisted labels for this exact program only.
    # Derived solve records are deliberately separate statistics rows: grouping
    # them with their parent would make a clicked summary row disagree with its
    # detail count.
    return spec.aliases


def internal_substep_programs() -> tuple[str, ...]:
    return tuple(
        alias
        for spec in PROGRAM_SPECS
        if not spec.history_visible
        for alias in spec.aliases
    )
