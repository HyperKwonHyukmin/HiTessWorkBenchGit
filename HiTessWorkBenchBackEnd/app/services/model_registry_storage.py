"""Model Registry 영구 저장소 — 경로 해석 + 원자적 publish.

왜 별도 루트인가:
    userConnection/ 은 cleanup_service.run_cleanup() 이 30일 뒤 **예외 없이** 지운다
    (화이트리스트/보존 플래그가 없다). 따라서 영구 보관 대상은 반드시 그 밖에 둔다.

경로 결정 순서 (carling_report_service._resolve_report_dir 선례와 동일):
    env(MODEL_REGISTRY_DIR) → 사내 공유 UNC → 백엔드 로컬 DataStorage/ModelRegistry

publish 는 staging 에 전부 쓰고 checksum 을 재검증한 뒤 os.replace 로 한 번에 확정한다.
staging 을 반드시 registry root 안에 두는 이유는 os.replace 의 원자성이 **동일 볼륨**에서만
보장되기 때문이다(시스템 temp 로 옮기면 cross-device 로 깨진다).
"""
from __future__ import annotations

import hashlib
import logging
import os
import shutil
import time
import uuid
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

# app/services/ → app/ → HiTessWorkBenchBackEnd/
_SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(os.path.dirname(_SERVICE_DIR))

_SHARE_REGISTRY_DIR = (
    r"\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44"
    r"\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\ModelRegistry"
)
# ⚠ 폴더 이름은 'DataStorage' 그대로 둔다. 화면 이름이 Data Storage → Model Library 로
# 바뀌었어도 **이 경로는 디스크 위치**이고, DB 에는 이 루트 기준 상대경로만 들어 있다.
# 폴더를 바꾸면 이미 등록된 모델의 다운로드가 전부 404 가 된다(§운영 가이드 3장).
_LOCAL_REGISTRY_DIR = os.path.join(_BACKEND_DIR, "DataStorage", "ModelRegistry")

STAGING_DIRNAME = ".staging"
MODELS_DIRNAME = "models"

DEFAULT_MAX_PACKAGE_MB = 500

# 이보다 오래된 staging 폴더는 중단된 등록의 잔해로 본다.
# 등록 1건의 최대 소요(대용량 복사 + checksum)보다 훨씬 길게 잡아 진행 중인 작업을 지우지 않는다.
STALE_STAGING_SECONDS = 6 * 3600


class RegistryStorageError(Exception):
    """저장소 계층의 도메인 오류. 라우터가 HTTP 코드로 변환한다."""

    code = "REGISTRY_STORAGE_ERROR"


class StorageUnavailable(RegistryStorageError):
    code = "REGISTRY_STORAGE_UNAVAILABLE"


class ChecksumMismatch(RegistryStorageError):
    code = "CHECKSUM_MISMATCH"


class PackageTooLarge(RegistryStorageError):
    code = "PACKAGE_TOO_LARGE"


class RevisionAlreadyPublished(RegistryStorageError):
    code = "REVISION_ALREADY_PUBLISHED"


def is_within_dir(base_dir: str, candidate_path: str) -> bool:
    """candidate_path 가 base_dir 하위인지 commonpath 로 검증한다.

    analysis.py._is_within_dir 과 동일한 구현이다. 문자열 startswith 로 판정하면
    '/data/foo' 와 '/data/foobar' 를 구분하지 못해 경로 탈출이 뚫린다.
    Windows 에서 드라이브레터 대소문자 차이로 legit 경로가 오탐되지 않도록 normcase 로 통일한다.
    """
    try:
        base = os.path.normcase(os.path.abspath(base_dir))
        candidate = os.path.normcase(os.path.abspath(candidate_path))
        return os.path.commonpath([base, candidate]) == base
    except ValueError:
        return False


def max_package_bytes() -> int:
    raw = os.environ.get("MODEL_REGISTRY_MAX_PACKAGE_MB")
    try:
        mb = int(raw) if raw else DEFAULT_MAX_PACKAGE_MB
    except (TypeError, ValueError):
        mb = DEFAULT_MAX_PACKAGE_MB
    return max(mb, 1) * 1024 * 1024


def resolve_registry_root(*, create: bool = True) -> str:
    """등록 저장소 루트를 결정한다.

    DB 에는 이 루트 **기준 상대경로**만 저장하므로, 루트가 바뀌면 이전에 등록한
    artifact 를 전부 찾을 수 없게 된다. 그래서 선택 규칙이 안정적이어야 한다:

    1. `MODEL_REGISTRY_DIR` 이 있으면 **무조건** 그것. 없으면 만들고, 못 만들면 503 으로
       크게 실패한다. 명시 설정이 있는데 조용히 다른 폴더로 새면 파일이 흩어진다.
    2. 후보 중 **이미 models/ 가 들어 있는(=사용 중인)** 루트. 나중에 UNC 가 마운트됐다고
       해서 로컬에 쌓아 둔 등록본을 놔두고 루트를 갈아타면 안 된다.
    3. 그 다음에야 선호 순서(UNC → 로컬)의 첫 존재 폴더.
    4. 아무것도 없으면 로컬 폴백을 만든다(create=False 면 경로만 돌려준다).
    """
    env_root = os.environ.get("MODEL_REGISTRY_DIR")
    if env_root:
        root = os.path.abspath(env_root)
        if not os.path.isdir(root) and create:
            try:
                os.makedirs(root, exist_ok=True)
            except OSError as exc:
                raise StorageUnavailable(
                    f"MODEL_REGISTRY_DIR 을 사용할 수 없습니다: {root} ({exc})"
                ) from exc
        return _remember(root)

    candidates = [_SHARE_REGISTRY_DIR, _LOCAL_REGISTRY_DIR]
    existing = [c for c in candidates if os.path.isdir(c)]

    for cand in existing:
        if os.path.isdir(os.path.join(cand, MODELS_DIRNAME)):
            return _remember(os.path.abspath(cand))
    if existing:
        return _remember(os.path.abspath(existing[0]))

    root = os.path.abspath(_LOCAL_REGISTRY_DIR)
    if create:
        try:
            os.makedirs(root, exist_ok=True)
        except OSError as exc:
            raise StorageUnavailable(
                f"등록 저장소를 생성할 수 없습니다: {root} ({exc})"
            ) from exc
    return _remember(root)


# 프로세스 수명 동안 마지막으로 고른 루트. 바뀌면 경고한다 — 조용한 전환은
# '다운로드만 404 나는' 형태로 뒤늦게 드러나서 원인 추적이 어렵다.
_last_resolved_root: Optional[str] = None


def _remember(root: str) -> str:
    global _last_resolved_root
    if _last_resolved_root is not None and _last_resolved_root != root:
        logger.warning(
            "[registry] 저장소 루트가 %s → %s 로 바뀌었습니다. "
            "이전 루트에 저장된 artifact 는 다운로드되지 않습니다.",
            _last_resolved_root, root,
        )
    _last_resolved_root = root
    return root


def ensure_writable(root: str) -> None:
    """루트에 실제로 쓸 수 있는지 확인한다. 마운트 해제된 UNC 를 조기에 걸러낸다."""
    probe = os.path.join(root, STAGING_DIRNAME)
    try:
        os.makedirs(probe, exist_ok=True)
    except OSError as exc:
        raise StorageUnavailable(f"등록 저장소에 쓸 수 없습니다: {root} ({exc})") from exc


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def revision_relative_path(model_uid: str, revision_no: int) -> str:
    """DB 에 저장하는 revision 상대경로. 절대/UNC 경로는 DB·응답에 넣지 않는다."""
    return f"{MODELS_DIRNAME}/{model_uid}/rev-{revision_no:04d}"


def absolute_path(root: str, relative_path: str) -> str:
    """root 기준 상대경로를 절대경로로 바꾸고 다시 루트 격리를 확인한다.

    DB 값이 오염되었더라도 루트 밖 파일을 서빙하지 않도록 하는 마지막 방어선이다.
    """
    full = os.path.abspath(os.path.join(root, relative_path.replace("/", os.sep)))
    if not is_within_dir(root, full):
        raise RegistryStorageError(f"등록 저장소 밖 경로입니다: {relative_path}")
    return full


class PendingArtifact:
    """staging 에 복사할 파일 하나의 명세."""

    __slots__ = ("kind", "source_path", "file_name", "media_type")

    def __init__(
        self,
        kind: str,
        source_path: str,
        file_name: str,
        media_type: str = "application/octet-stream",
    ) -> None:
        self.kind = kind
        self.source_path = source_path
        self.file_name = file_name
        self.media_type = media_type


def publish_revision(
    *,
    root: str,
    model_uid: str,
    revision_no: int,
    artifacts: Iterable[PendingArtifact],
    inline_files: Optional[dict[str, tuple[str, bytes]]] = None,
) -> dict:
    """staging 에 전부 쓰고 검증한 뒤 revision 폴더를 원자적으로 확정한다.

    Args:
        root:          registry root (resolve_registry_root 결과)
        model_uid:     모델 UUID
        revision_no:   1부터 증가하는 revision 번호
        artifacts:     디스크에서 복사할 파일들
        inline_files:  메모리에서 바로 쓸 파일들 {kind: (file_name, bytes)}
                       — summary.json / manifest.json 처럼 생성물인 경우

    Returns:
        {"relative_path": str, "artifacts": [{kind,file_name,relative_path,size_bytes,sha256,media_type}, ...]}

    Raises:
        StorageUnavailable / ChecksumMismatch / PackageTooLarge / RevisionAlreadyPublished
    """
    ensure_writable(root)

    rel_dir = revision_relative_path(model_uid, revision_no)
    final_dir = absolute_path(root, rel_dir)
    if os.path.exists(final_dir):
        raise RevisionAlreadyPublished(f"이미 발행된 revision 입니다: {rel_dir}")

    staging_root = os.path.join(root, STAGING_DIRNAME)
    _sweep_stale_staging(staging_root)
    staging_dir = os.path.join(staging_root, uuid.uuid4().hex)
    limit = max_package_bytes()
    total = 0
    written: list[dict] = []

    try:
        os.makedirs(staging_dir, exist_ok=False)

        for art in artifacts:
            # 복사 '전에' 크기를 확인한다 — 제한을 넘는 파일을 일단 쓰고 나서 지우면
            # 그 사이 디스크를 채워 다른 등록까지 실패시킬 수 있다.
            try:
                incoming = os.path.getsize(art.source_path)
            except OSError as exc:
                raise StorageUnavailable(
                    f"artifact 를 읽을 수 없습니다: {art.file_name} ({exc})"
                ) from exc
            if total + incoming > limit:
                raise PackageTooLarge(
                    f"등록 패키지가 제한({limit // (1024 * 1024)}MB)을 초과했습니다."
                )

            dst = os.path.join(staging_dir, os.path.basename(art.file_name))
            try:
                shutil.copyfile(art.source_path, dst)
            except OSError as exc:
                raise StorageUnavailable(
                    f"artifact 복사 실패: {art.file_name} ({exc})"
                ) from exc

            # 복사본을 다시 읽어 원본과 대조 — 부분 복사/디스크 오류를 여기서 잡는다.
            expected = sha256_of(art.source_path)
            actual = sha256_of(dst)
            if expected != actual:
                raise ChecksumMismatch(
                    f"복사본 checksum 이 원본과 다릅니다: {art.file_name}"
                )

            size = os.path.getsize(dst)
            total += size
            written.append({
                "kind": art.kind,
                "file_name": os.path.basename(art.file_name),
                "relative_path": f"{rel_dir}/{os.path.basename(art.file_name)}",
                "size_bytes": size,
                "sha256": actual,
                "media_type": art.media_type,
            })

        for kind, (file_name, payload) in (inline_files or {}).items():
            if total + len(payload) > limit:
                raise PackageTooLarge(
                    f"등록 패키지가 제한({limit // (1024 * 1024)}MB)을 초과했습니다."
                )
            dst = os.path.join(staging_dir, os.path.basename(file_name))
            try:
                with open(dst, "wb") as f:
                    f.write(payload)
            except OSError as exc:
                raise StorageUnavailable(f"{file_name} 기록 실패: {exc}") from exc
            total += len(payload)
            written.append({
                "kind": kind,
                "file_name": os.path.basename(file_name),
                "relative_path": f"{rel_dir}/{os.path.basename(file_name)}",
                "size_bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "media_type": "application/json",
            })

        os.makedirs(os.path.dirname(final_dir), exist_ok=True)
        try:
            os.replace(staging_dir, final_dir)
        except OSError as exc:
            # Windows 는 대상 디렉터리가 존재하면 실패한다 → 동시 등록 충돌로 본다.
            raise RevisionAlreadyPublished(
                f"revision 폴더 확정에 실패했습니다: {rel_dir} ({exc})"
            ) from exc
    except Exception:
        _safe_rmtree(staging_dir)
        raise

    return {"relative_path": rel_dir, "artifacts": written}


def unpublish_revision(root: str, relative_path: str) -> None:
    """DB commit 실패 시 이미 확정된 revision 폴더를 되돌린다(보상 트랜잭션).

    실패해도 예외를 올리지 않는다 — 원래 오류를 가리면 안 되기 때문이다.
    대신 orphan 으로 남았음을 error 로 남겨 운영자가 정리할 수 있게 한다.
    """
    try:
        target = absolute_path(root, relative_path)
    except RegistryStorageError:
        logger.error("[registry] 정리 대상 경로가 저장소 밖입니다: %s", relative_path)
        return
    if not os.path.isdir(target):
        return
    try:
        shutil.rmtree(target)
    except OSError:
        logger.error(
            "[registry] orphan revision 정리 실패 — 수동 정리 필요: %s", target,
            exc_info=True,
        )
        return

    # 이 모델의 마지막 revision 이었다면 빈 모델 폴더도 치운다.
    # (등록 실패마다 빈 <model-uid>/ 가 쌓이면 저장소가 지저분해진다.)
    parent = os.path.dirname(target)
    try:
        if os.path.isdir(parent) and not os.listdir(parent):
            os.rmdir(parent)
    except OSError:
        pass


def _sweep_stale_staging(staging_root: str) -> None:
    """중단된 등록이 남긴 staging 폴더를 걷어낸다.

    publish 는 예외 경로에서 staging 을 정리하지만 **프로세스가 강제 종료되면 남는다.**
    남은 폴더는 아무도 보지 않는 채로 디스크를 갉아먹으므로, 다음 등록 때 충분히 오래된
    것만 지운다. 진행 중인 다른 등록을 건드리지 않도록 임계값을 넉넉히 잡는다.
    """
    try:
        entries = os.listdir(staging_root)
    except OSError:
        return
    cutoff = time.time() - STALE_STAGING_SECONDS
    for name in entries:
        path = os.path.join(staging_root, name)
        try:
            if os.path.isdir(path) and os.path.getmtime(path) < cutoff:
                shutil.rmtree(path, ignore_errors=True)
                logger.info("[registry] 오래된 staging 정리: %s", path)
        except OSError:
            continue


def _safe_rmtree(path: str) -> None:
    if not path or not os.path.isdir(path):
        return
    try:
        shutil.rmtree(path)
    except OSError:
        logger.warning("[registry] staging 정리 실패: %s", path, exc_info=True)
