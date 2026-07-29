"""Model Registry — 영구 저장소 publisher 테스트.

핵심 계약:
- publish 는 staging 에 전부 쓰고 검증한 뒤 os.replace 로 한 번에 확정한다(부분 노출 금지).
- 실패하면 staging 이 남지 않는다.
- DB 에는 registry root 기준 상대경로만 들어간다(절대/UNC 경로 노출 금지).
- 저장소 루트는 userConnection 밖이어야 한다 — 30일 cleanup 대상이 되면 안 된다.
"""
import hashlib
import os
import time

import pytest

from app.services import model_registry_storage as storage
from app.services.model_registry_storage import (
    ChecksumMismatch,
    PackageTooLarge,
    PendingArtifact,
    RegistryStorageError,
    RevisionAlreadyPublished,
    StorageUnavailable,
    absolute_path,
    is_within_dir,
    max_package_bytes,
    publish_revision,
    resolve_registry_root,
    revision_relative_path,
    unpublish_revision,
)


@pytest.fixture()
def registry_root(tmp_path, monkeypatch):
    root = tmp_path / "ModelRegistry"
    root.mkdir()
    monkeypatch.setenv("MODEL_REGISTRY_DIR", str(root))
    return str(root)


@pytest.fixture()
def src_bdf(tmp_path):
    p = tmp_path / "src" / "model.bdf"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("CEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    return str(p)


def _artifact(path, kind="bdf", name="source.bdf"):
    return PendingArtifact(kind, path, name)


# --------------------------------------------------------------------------- #
# 루트 해석
# --------------------------------------------------------------------------- #

def test_env_var_takes_priority(registry_root):
    assert resolve_registry_root() == os.path.abspath(registry_root)


def test_falls_back_to_local_dir_when_env_missing(monkeypatch, tmp_path):
    monkeypatch.delenv("MODEL_REGISTRY_DIR", raising=False)
    monkeypatch.setattr(storage, "_SHARE_REGISTRY_DIR", str(tmp_path / "nonexistent-unc"))
    local = tmp_path / "local-registry"
    monkeypatch.setattr(storage, "_LOCAL_REGISTRY_DIR", str(local))

    root = resolve_registry_root()

    assert root == os.path.abspath(str(local))
    assert os.path.isdir(root)


def test_env_root_is_created_rather_than_silently_falling_back(monkeypatch, tmp_path):
    """명시 설정이 있는데 조용히 다른 폴더로 새면 등록본이 두 곳으로 흩어진다."""
    target = tmp_path / "explicit-root"
    monkeypatch.setenv("MODEL_REGISTRY_DIR", str(target))
    monkeypatch.setattr(storage, "_SHARE_REGISTRY_DIR", str(tmp_path / "unc"))
    (tmp_path / "unc").mkdir()

    root = resolve_registry_root()

    assert root == os.path.abspath(str(target))
    assert os.path.isdir(root)


def test_in_use_root_wins_over_preference_order(monkeypatch, tmp_path):
    """이미 등록본이 쌓인 루트를 두고 루트를 갈아타면 기존 다운로드가 전부 깨진다.

    UNC 가 나중에 마운트되는 상황이 정확히 이 시나리오다 —
    선호 순서(UNC 우선)를 그대로 따르면 로컬에 쌓인 모델이 통째로 사라진 것처럼 보인다.
    """
    monkeypatch.delenv("MODEL_REGISTRY_DIR", raising=False)
    unc = tmp_path / "unc"
    local = tmp_path / "local"
    unc.mkdir()
    (local / storage.MODELS_DIRNAME).mkdir(parents=True)   # 로컬이 사용 중
    monkeypatch.setattr(storage, "_SHARE_REGISTRY_DIR", str(unc))
    monkeypatch.setattr(storage, "_LOCAL_REGISTRY_DIR", str(local))

    assert resolve_registry_root() == os.path.abspath(str(local))


def test_preference_order_applies_when_no_root_is_in_use(monkeypatch, tmp_path):
    """아직 아무 데도 안 쓰고 있으면 원래 선호 순서(UNC 우선)를 따른다."""
    monkeypatch.delenv("MODEL_REGISTRY_DIR", raising=False)
    unc = tmp_path / "unc"
    local = tmp_path / "local"
    unc.mkdir()
    local.mkdir()
    monkeypatch.setattr(storage, "_SHARE_REGISTRY_DIR", str(unc))
    monkeypatch.setattr(storage, "_LOCAL_REGISTRY_DIR", str(local))

    assert resolve_registry_root() == os.path.abspath(str(unc))


def test_local_fallback_is_outside_userconnection():
    """30일 cleanup 은 userConnection 하위를 예외 없이 지운다 — 그 밖이어야 영구 보관이다."""
    from app.routers._intake import USER_CONNECTION_DIR

    assert not is_within_dir(USER_CONNECTION_DIR, storage._LOCAL_REGISTRY_DIR)


# --------------------------------------------------------------------------- #
# 경로 격리
# --------------------------------------------------------------------------- #

def test_is_within_dir_rejects_sibling_prefix(tmp_path):
    """문자열 startswith 였다면 통과했을 케이스 — commonpath 라야 막힌다."""
    base = tmp_path / "data"
    base.mkdir()
    sibling = tmp_path / "data-evil"
    sibling.mkdir()
    assert is_within_dir(str(base), str(base / "x.bdf")) is True
    assert is_within_dir(str(base), str(sibling / "x.bdf")) is False


def test_absolute_path_rejects_traversal(registry_root):
    with pytest.raises(RegistryStorageError):
        absolute_path(registry_root, "../../etc/passwd")


def test_revision_relative_path_is_zero_padded():
    assert revision_relative_path("uid-1", 1) == "models/uid-1/rev-0001"
    assert revision_relative_path("uid-1", 42) == "models/uid-1/rev-0042"


# --------------------------------------------------------------------------- #
# publish
# --------------------------------------------------------------------------- #

def test_publish_writes_artifacts_and_returns_relative_paths(registry_root, src_bdf):
    result = publish_revision(
        root=registry_root,
        model_uid="uid-1",
        revision_no=1,
        artifacts=[_artifact(src_bdf)],
        inline_files={"summary": ("summary.json", b'{"schemaVersion":"1.0"}')},
    )

    assert result["relative_path"] == "models/uid-1/rev-0001"
    kinds = {a["kind"]: a for a in result["artifacts"]}
    assert set(kinds) == {"bdf", "summary"}

    for art in result["artifacts"]:
        # 상대경로만 — 절대/UNC 경로가 DB 로 새어 나가면 안 된다.
        assert not os.path.isabs(art["relative_path"])
        assert art["relative_path"].startswith("models/uid-1/rev-0001/")
        assert os.path.isfile(os.path.join(registry_root, *art["relative_path"].split("/")))


def test_publish_records_correct_checksums_and_sizes(registry_root, src_bdf):
    raw = open(src_bdf, "rb").read()
    result = publish_revision(
        root=registry_root, model_uid="uid-1", revision_no=1,
        artifacts=[_artifact(src_bdf)],
    )
    bdf = next(a for a in result["artifacts"] if a["kind"] == "bdf")

    assert bdf["sha256"] == hashlib.sha256(raw).hexdigest()
    assert bdf["size_bytes"] == len(raw)


def test_publish_leaves_no_staging_behind(registry_root, src_bdf):
    publish_revision(
        root=registry_root, model_uid="uid-1", revision_no=1,
        artifacts=[_artifact(src_bdf)],
    )
    staging = os.path.join(registry_root, storage.STAGING_DIRNAME)
    assert os.listdir(staging) == []


def test_publish_rejects_duplicate_revision_dir(registry_root, src_bdf):
    kw = dict(root=registry_root, model_uid="uid-1", revision_no=1)
    publish_revision(artifacts=[_artifact(src_bdf)], **kw)
    with pytest.raises(RevisionAlreadyPublished):
        publish_revision(artifacts=[_artifact(src_bdf)], **kw)


def test_publish_fails_and_cleans_up_when_source_missing(registry_root, tmp_path):
    missing = str(tmp_path / "nope.bdf")

    with pytest.raises(StorageUnavailable):
        publish_revision(
            root=registry_root, model_uid="uid-1", revision_no=1,
            artifacts=[_artifact(missing)],
        )

    assert not os.path.exists(os.path.join(registry_root, "models", "uid-1"))
    assert os.listdir(os.path.join(registry_root, storage.STAGING_DIRNAME)) == []


def test_publish_detects_checksum_mismatch(registry_root, src_bdf, monkeypatch):
    """복사 도중 손상되면 revision 을 확정하지 않는다."""
    real = storage.sha256_of
    calls = {"n": 0}

    def flaky(path):
        calls["n"] += 1
        # 두 번째 호출(복사본 검증)만 다른 값을 돌려 손상을 흉내낸다.
        return "f" * 64 if calls["n"] == 2 else real(path)

    monkeypatch.setattr(storage, "sha256_of", flaky)

    with pytest.raises(ChecksumMismatch):
        publish_revision(
            root=registry_root, model_uid="uid-1", revision_no=1,
            artifacts=[_artifact(src_bdf)],
        )

    assert not os.path.exists(os.path.join(registry_root, "models", "uid-1"))
    assert os.listdir(os.path.join(registry_root, storage.STAGING_DIRNAME)) == []


def test_publish_enforces_package_size_limit(registry_root, tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_REGISTRY_MAX_PACKAGE_MB", "1")
    big = tmp_path / "big.bdf"
    big.write_bytes(b"x" * (2 * 1024 * 1024))

    with pytest.raises(PackageTooLarge):
        publish_revision(
            root=registry_root, model_uid="uid-1", revision_no=1,
            artifacts=[PendingArtifact("bdf", str(big), "source.bdf")],
        )

    assert not os.path.exists(os.path.join(registry_root, "models", "uid-1"))


def test_publish_is_atomic_no_partial_revision_dir(registry_root, src_bdf, monkeypatch):
    """inline 기록 단계에서 실패해도 revision 폴더가 부분 상태로 노출되지 않는다."""
    monkeypatch.setenv("MODEL_REGISTRY_MAX_PACKAGE_MB", "1")
    huge = b"y" * (2 * 1024 * 1024)

    with pytest.raises(PackageTooLarge):
        publish_revision(
            root=registry_root, model_uid="uid-1", revision_no=1,
            artifacts=[_artifact(src_bdf)],
            inline_files={"summary": ("summary.json", huge)},
        )

    assert not os.path.exists(os.path.join(registry_root, "models", "uid-1", "rev-0001"))


def test_publish_sweeps_stale_staging_but_spares_recent(registry_root, src_bdf):
    """프로세스가 강제 종료되면 staging 이 남는다 — 조용히 디스크를 갉아먹지 않게 한다."""
    staging = os.path.join(registry_root, storage.STAGING_DIRNAME)
    os.makedirs(staging, exist_ok=True)
    stale = os.path.join(staging, "stale-run")
    recent = os.path.join(staging, "recent-run")
    os.makedirs(stale)
    os.makedirs(recent)
    old = time.time() - storage.STALE_STAGING_SECONDS - 60
    os.utime(stale, (old, old))

    publish_revision(
        root=registry_root, model_uid="uid-1", revision_no=1,
        artifacts=[_artifact(src_bdf)],
    )

    assert not os.path.exists(stale)
    # 진행 중일 수 있는 최근 staging 은 건드리지 않는다.
    assert os.path.isdir(recent)


def test_max_package_bytes_defaults_and_parses(monkeypatch):
    monkeypatch.delenv("MODEL_REGISTRY_MAX_PACKAGE_MB", raising=False)
    assert max_package_bytes() == storage.DEFAULT_MAX_PACKAGE_MB * 1024 * 1024
    monkeypatch.setenv("MODEL_REGISTRY_MAX_PACKAGE_MB", "7")
    assert max_package_bytes() == 7 * 1024 * 1024
    monkeypatch.setenv("MODEL_REGISTRY_MAX_PACKAGE_MB", "쓰레기")
    assert max_package_bytes() == storage.DEFAULT_MAX_PACKAGE_MB * 1024 * 1024


# --------------------------------------------------------------------------- #
# 보상 트랜잭션
# --------------------------------------------------------------------------- #

def test_unpublish_removes_revision_dir(registry_root, src_bdf):
    result = publish_revision(
        root=registry_root, model_uid="uid-1", revision_no=1,
        artifacts=[_artifact(src_bdf)],
    )
    unpublish_revision(registry_root, result["relative_path"])
    assert not os.path.exists(os.path.join(registry_root, "models", "uid-1", "rev-0001"))


def test_unpublish_also_removes_now_empty_model_dir(registry_root, src_bdf):
    """등록 실패마다 빈 <model-uid>/ 가 쌓이지 않아야 한다."""
    result = publish_revision(
        root=registry_root, model_uid="uid-1", revision_no=1,
        artifacts=[_artifact(src_bdf)],
    )
    unpublish_revision(registry_root, result["relative_path"])
    assert not os.path.exists(os.path.join(registry_root, "models", "uid-1"))


def test_unpublish_keeps_model_dir_when_other_revisions_remain(registry_root, src_bdf):
    """다른 revision 이 남아 있으면 모델 폴더를 지우면 안 된다."""
    publish_revision(
        root=registry_root, model_uid="uid-1", revision_no=1,
        artifacts=[_artifact(src_bdf)],
    )
    second = publish_revision(
        root=registry_root, model_uid="uid-1", revision_no=2,
        artifacts=[_artifact(src_bdf)],
    )
    unpublish_revision(registry_root, second["relative_path"])

    assert os.path.isdir(os.path.join(registry_root, "models", "uid-1", "rev-0001"))
    assert not os.path.exists(os.path.join(registry_root, "models", "uid-1", "rev-0002"))


def test_unpublish_is_silent_when_already_gone(registry_root):
    unpublish_revision(registry_root, "models/uid-1/rev-0001")  # 예외 없이 통과


def test_unpublish_refuses_paths_outside_root(registry_root, tmp_path):
    """보상 로직이 저장소 밖을 지우는 일은 절대 없어야 한다."""
    victim = tmp_path / "victim"
    victim.mkdir()
    unpublish_revision(registry_root, "../victim")
    assert victim.exists()


def test_ensure_writable_raises_when_root_is_a_file(tmp_path):
    bogus = tmp_path / "not-a-dir"
    bogus.write_text("x", encoding="utf-8")
    with pytest.raises(StorageUnavailable):
        storage.ensure_writable(str(bogus))
