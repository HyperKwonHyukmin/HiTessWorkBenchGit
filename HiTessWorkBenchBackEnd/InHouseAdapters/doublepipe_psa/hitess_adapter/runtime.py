"""소스 직접 실행 모드 — 실행할 때 엔진 사본을 만들고 Tier-2 패치를 적용한다.

exe 빌드에서는 `prep.py` 가 빌드 시점에 사본(스테이징)을 만들어 패치한다. 소스 실행
(`python -m hitess_adapter.psa_main ...`)에서는 그 일을 실행 시점에 한다 — 그래야 엔진 개발자가
엔진 폴더의 `.py` 만 고쳐도 다음 해석부터 반영되고, 우리 패치도 사라지지 않는다.

  * 원본 엔진 폴더는 읽기만 한다(사본에만 패치).
  * 사본은 엔진 파일 목록·크기·수정 시각 + patches.py 내용으로 만든 지문 폴더에 캐시한다.
    엔진이 바뀌지 않았으면 다시 복사하지 않는다.
  * 앵커가 안 맞으면 PatchError — 조용히 패치 없는 엔진으로 돌지 않는다.
"""
import hashlib
import os
import shutil

from . import engine as engine_mod
from . import patches as patches_mod
from . import prep

RUNTIME_DIR_ENV = "DOUBLEPIPE_RUNTIME_DIR"
_READY_MARK = ".hitess_ready"


def default_runtime_root():
    return os.path.join(prep.adapter_root(), "build", "runtime")


def _iter_engine_files(engine_dir):
    """사본에 들어갈 파일(prep.stage_engine 과 같은 제외 규칙)을 상대경로 순서대로."""
    for directory, dirnames, filenames in os.walk(engine_dir):
        dirnames[:] = sorted(d for d in dirnames if d not in prep._EXCLUDE_DIRS)
        for name in sorted(filenames):
            if prep._is_excluded(name):
                continue
            full = os.path.join(directory, name)
            yield os.path.relpath(full, engine_dir), full


def fingerprint(engine_dir):
    """엔진 파일 상태 + 패치 정의로 만든 지문(16자리)."""
    digest = hashlib.sha256()
    for rel, full in _iter_engine_files(engine_dir):
        stat = os.stat(full)
        digest.update(f"{rel}|{stat.st_size}|{stat.st_mtime_ns}\n".encode("utf-8"))
    with open(patches_mod.__file__, "rb") as handle:
        digest.update(handle.read())
    return digest.hexdigest()[:16]


def _remove_old(runtime_root, keep):
    """이전 지문 사본을 지운다(실패해도 실행은 계속 — 다음 실행 때 다시 시도)."""
    for name in os.listdir(runtime_root):
        if name == keep:
            continue
        shutil.rmtree(os.path.join(runtime_root, name), ignore_errors=True)


def prepare_engine(engine_dir=None, runtime_root=None):
    """패치 적용된 엔진 사본 경로를 돌려주고, 엔진 로더가 그 사본을 쓰도록 환경변수를 바꾼다."""
    engine_dir = engine_dir or engine_mod.resolve_engine_dir()
    if engine_dir is None:
        raise engine_mod.EngineContractError("exe(frozen) 실행에서는 엔진 사본을 만들지 않습니다.")
    engine_dir = os.path.abspath(engine_dir)
    if not os.path.isdir(engine_dir):
        raise engine_mod.EngineContractError(f"엔진 폴더를 찾을 수 없습니다: {engine_dir}")
    runtime_root = os.path.abspath(
        runtime_root or os.environ.get(RUNTIME_DIR_ENV) or default_runtime_root())
    os.makedirs(runtime_root, exist_ok=True)

    key = fingerprint(engine_dir)
    target = os.path.join(runtime_root, key)
    if os.path.isfile(os.path.join(target, _READY_MARK)):
        print(f"[엔진] 소스 실행 — 캐시된 엔진 사본 사용: {target}")
    else:
        print(f"[엔진] 소스 실행 — 엔진이 바뀌어 사본을 새로 만듭니다: {engine_dir}")
        temp = f"{target}.tmp-{os.getpid()}"
        shutil.rmtree(temp, ignore_errors=True)
        prep.stage_engine(engine_dir, temp)
        prep.apply_patches(temp)
        with open(os.path.join(temp, _READY_MARK), "w", encoding="utf-8") as handle:
            handle.write(engine_dir)
        shutil.rmtree(target, ignore_errors=True)
        try:
            os.replace(temp, target)
        except OSError:
            # 같은 지문을 다른 프로세스가 먼저 만들었다 — 그쪽을 쓴다.
            shutil.rmtree(temp, ignore_errors=True)
            if not os.path.isfile(os.path.join(target, _READY_MARK)):
                raise
        _remove_old(runtime_root, keep=key)

    os.environ[engine_mod.ENGINE_DIR_ENV] = target
    return target
