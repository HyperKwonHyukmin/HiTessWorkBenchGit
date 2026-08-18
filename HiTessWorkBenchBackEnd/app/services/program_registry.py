"""Canonical metadata for programs recorded in the Analysis table.

The registry is deliberately additive: services continue to persist their existing
``program_name`` values.  It only gives read-side features (statistics, passports,
and rerun dispatch) one immutable place to understand historical aliases.
"""
from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Final


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

    def __post_init__(self) -> None:
        if not self.program_id or not self.aliases:
            raise ValueError("ProgramSpec requires a program_id and at least one alias")
        if len({alias.casefold() for alias in self.aliases}) != len(self.aliases):
            raise ValueError(f"Duplicate aliases in {self.program_id}")


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
) -> ProgramSpec:
    return ProgramSpec(
        program_id=program_id,
        display_name=display_name,
        aliases=tuple(dict.fromkeys((display_name, *aliases))),
        capabilities=frozenset(capabilities),
        history_visible=history_visible,
        rerun_adapter=rerun_adapter,
        input_keys=input_keys,
        statistics_group=statistics_group,
        report_adapter=report_adapter,
        report_template=report_template,
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
        capabilities=("file-analysis", "rerun", "passport", "report"),
        rerun_adapter="truss-assessment",
        input_keys=("bdf_model",),
        report_adapter="truss-assessment",
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
    ),
    _spec(
        "hp-scr-por", "HP-SCR POR",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="hp-scr",
        input_keys=("bdf_model",),
        statistics_group="hp-scr",
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
    ),
    _spec(
        "simple-beam", "Simple Beam Assessment", "Beam Analysis",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="simple-beam",
        input_keys=("input_json",),
    ),
    _spec(
        "group-module-unit", "GroupModuleUnit", "Group & Module Unit 권상 구조 해석",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="group-module-unit",
        input_keys=("bdf_model",),
    ),
    _spec(
        "side-passage", "SidePassage", "Side Passage Assessment",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="side-passage",
        input_keys=("bdf_model",),
    ),
    _spec(
        "hull-acceleration", "선급 Rule 기반 선체 가속도 Calculation", "HullAcceleration",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="hull-acceleration",
        input_keys=("pdf_file", "constants", "condition_overrides"),
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
    ),
    _spec(
        "double-pipe-fuel-line", "DoublePipeFuelLine", "이중관 구조 연료배관 해석",
        capabilities=("file-analysis", "passport"),
        input_keys=("input_csv", "csv_file"),
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
    ),
    _spec(
        "carling-optimization", "Carling Design Optimization",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
    ),
    _spec(
        "column-buckling", "Column Buckling Load Calculator",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
    ),
    _spec(
        "mast-post", "Mast Post Assessment",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
    ),
    _spec(
        "jib-rest", "Jib Rest Assessment",
        "Jib Rest Assessment (1단)", "Jib Rest Assessment (2단)",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
    ),
    _spec(
        "d-type-lug", "D Type Lug Assessment",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
    ),
    _spec(
        "hole-fatigue", "Simplified Hole Fatigue Assessment",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
    ),
    _spec(
        "section-property", "Section Property Calculator",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
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
