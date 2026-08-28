"""엔진(연구원 원본) 로딩 + 계약 검증.

엔진 폴더는 어댑터가 **읽기만** 한다. 새 버전이 오면 폴더째 덮어써도 되도록, 어댑터가
기대하는 심볼 집합을 여기서 명시하고 없으면 **무엇이 사라졌는지 이름을 찍어 즉시 실패**한다.
조용히 다른 경로로 도는 것보다 요란하게 죽는 편이 낫다 — 그래야 드리프트를 사람이 안다.
"""
import os
import sys

ENGINE_DIR_ENV = "DOUBLEPIPE_ENGINE_DIR"
ENGINE_FOLDER_NAME = "Piping Stress Analysis for all load cases"

# 어댑터가 실제로 호출하는 심볼만 적는다(과한 계약은 오탐을 만든다).
REQUIRED_SYMBOLS = {
    "AbaqusModelCreator": ("AbaqusModelCreator",),
    "Head_for_FuelLine_ASME_B313_v2018": (
        "HeadClass_01",
        "HeadClass_02",
        "make_report",
        "F06Format",
        "Parse_dat_file",
        "Non_fric_inp_parse",
        "ModifyINP",
        "Fric_inp_parse",
        "INP",
    ),
}

# HeadClass_01 인스턴스가 제공해야 하는 속성(모델 생성 후 런타임 검사).
REQUIRED_HEAD_ATTRS = (
    "LC_name",
    "LC_name_iter01",
    "LC_name_iter02",
    "filename",
    "datname",
    "Abaqus_Run",
)


class EngineContractError(RuntimeError):
    """엔진이 어댑터가 기대하는 인터페이스를 더 이상 제공하지 않을 때."""


def default_engine_dir():
    """개발(비-frozen) 실행 시의 기본 엔진 폴더 경로.

    .../HiTessWorkBenchBackEnd/InHouseAdapters/doublepipe_psa/hitess_adapter/engine.py
    → .../HiTessWorkBenchBackEnd/InHouseProgram/DoublePipe/<ENGINE_FOLDER_NAME>
    """
    here = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(here)))
    return os.path.join(backend_dir, "InHouseProgram", "DoublePipe", ENGINE_FOLDER_NAME)


def resolve_engine_dir():
    """엔진 폴더 경로. frozen(exe) 실행에서는 모듈이 이미 번들되어 있어 None 을 돌려준다."""
    if getattr(sys, "frozen", False):
        return None
    override = os.environ.get(ENGINE_DIR_ENV)
    if override:
        return os.path.abspath(override)
    return default_engine_dir()


def ensure_engine_on_path():
    """비-frozen 실행에서 엔진 폴더를 sys.path 앞에 얹는다(엔진은 flat import 구조)."""
    engine_dir = resolve_engine_dir()
    if engine_dir is None:
        return None
    if not os.path.isdir(engine_dir):
        raise EngineContractError(
            f"엔진 폴더를 찾을 수 없습니다: {engine_dir}\n"
            f"  → 환경변수 {ENGINE_DIR_ENV} 로 경로를 지정할 수 있습니다."
        )
    if engine_dir not in sys.path:
        sys.path.insert(0, engine_dir)
    return engine_dir


def load():
    """엔진 모듈을 import 하고 계약을 검증한 뒤, 심볼 dict 를 돌려준다."""
    ensure_engine_on_path()

    missing = []
    symbols = {}
    for module_name, names in REQUIRED_SYMBOLS.items():
        try:
            module = __import__(module_name)
        except ImportError as exc:
            missing.append(f"모듈 '{module_name}' import 실패: {exc}")
            continue
        for name in names:
            if not hasattr(module, name):
                missing.append(f"{module_name}.{name}")
            else:
                symbols[name] = getattr(module, name)

    if missing:
        raise EngineContractError(
            "엔진이 어댑터가 기대하는 인터페이스를 제공하지 않습니다(연구원 원본이 바뀐 것으로 보입니다).\n"
            "  누락: " + ", ".join(missing) + "\n"
            "  → hitess_adapter/engine.py 의 REQUIRED_SYMBOLS 와 cli.py 의 호출부를 새 엔진에 맞춰 갱신하세요."
        )
    return symbols


def verify_head_instance(head):
    """HeadClass_01 인스턴스가 파이프라인에 필요한 속성을 갖췄는지 검사한다."""
    missing = [name for name in REQUIRED_HEAD_ATTRS if not hasattr(head, name)]
    if missing:
        raise EngineContractError(
            "엔진 HeadClass_01 인스턴스에 필요한 속성이 없습니다: " + ", ".join(missing) + "\n"
            "  → 연구원 원본의 LoadCase 목록/실행 API 가 바뀌었습니다. cli.py 를 갱신하세요."
        )
    return head
