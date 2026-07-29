"""Model Registry — DB 모델 / Pydantic 스키마 / REST API 테스트.

Task 1 범위(schema/model)와 Task 5 범위(API)를 한 파일에 둔다.
`-k "schema or model"` 로 Task 1 부분만 돌릴 수 있게 테스트 이름을 맞춘다.
"""
import os

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app import models
from app.model_registry_schemas import (
    MAX_TAGS,
    SUMMARY_SCHEMA_VERSION,
    ModelPatchRequest,
    RegisterRequest,
    Visibility,
    normalize_tags,
)


def _make_model(db, *, uid="uid-1", title="기준 모델", **kw):
    m = models.RegisteredModel(model_uid=uid, title=title, **kw)
    db.add(m)
    db.commit()
    return m


def _make_revision(db, model_id, *, revision_no=1, sha="a" * 64, **kw):
    r = models.RegisteredModelRevision(
        model_id=model_id,
        revision_no=revision_no,
        schema_version="1.0",
        bdf_sha256=sha,
        storage_relative_path=f"models/uid-1/rev-{revision_no:04d}",
        **kw,
    )
    db.add(r)
    db.commit()
    return r


# --------------------------------------------------------------------------- #
# DB 모델
# --------------------------------------------------------------------------- #

def test_model_registry_tables_exist(db_session):
    insp = inspect(db_session.get_bind())
    for table in (
        "registered_models",
        "registered_model_revisions",
        "registered_model_artifacts",
    ):
        assert insp.has_table(table), f"{table} 이(가) create_all 로 생성되지 않았습니다."


def test_model_revision_no_is_unique_per_model(db_session):
    m = _make_model(db_session)
    _make_revision(db_session, m.id, revision_no=1, sha="a" * 64)
    with pytest.raises(IntegrityError):
        _make_revision(db_session, m.id, revision_no=1, sha="b" * 64)
    db_session.rollback()


def test_model_bdf_sha256_is_globally_unique(db_session):
    """같은 BDF 를 두 번 등록하면 DB 단에서 최종 차단된다(EXACT_DUPLICATE race 방어)."""
    m1 = _make_model(db_session, uid="uid-1")
    m2 = _make_model(db_session, uid="uid-2")
    _make_revision(db_session, m1.id, sha="c" * 64)
    with pytest.raises(IntegrityError):
        _make_revision(db_session, m2.id, sha="c" * 64)
    db_session.rollback()


def test_model_source_analysis_id_has_no_foreign_key(db_session):
    """Analysis 이력이 지워져도 등록된 모델은 남아야 하므로 FK/cascade 를 걸지 않는다."""
    insp = inspect(db_session.get_bind())
    fks = insp.get_foreign_keys("registered_model_revisions")
    constrained = {c for fk in fks for c in fk["constrained_columns"]}
    assert "source_analysis_id" not in constrained


def test_model_revision_scalars_default_to_null(db_session):
    """소스에 없는 값은 NULL 이어야 한다. 0 으로 대체하면 통계가 오염된다."""
    m = _make_model(db_session)
    r = _make_revision(db_session, m.id)
    assert r.node_count is None
    assert r.element_count is None
    assert r.total_mass_kg is None
    assert r.max_utilization is None


def test_model_artifact_links_to_revision(db_session):
    m = _make_model(db_session)
    r = _make_revision(db_session, m.id)
    a = models.RegisteredModelArtifact(
        revision_id=r.id,
        kind="bdf",
        file_name="source.bdf",
        relative_path=f"{r.storage_relative_path}/source.bdf",
        size_bytes=1234,
        sha256="d" * 64,
        media_type="application/octet-stream",
    )
    db_session.add(a)
    db_session.commit()
    assert a.id is not None
    assert a.revision_id == r.id


# --------------------------------------------------------------------------- #
# Pydantic 스키마
# --------------------------------------------------------------------------- #

def test_schema_default_visibility_is_company():
    req = RegisterRequest(
        source_analysis_id=1, artifact_kind="modelbuilder_final", title="T",
    )
    assert req.visibility is Visibility.COMPANY


def test_schema_tag_normalization_trims_lowercases_and_dedupes():
    req = RegisterRequest(
        source_analysis_id=1,
        artifact_kind="modelbuilder_final",
        title="T",
        tags=["  Beam ", "beam", "FRAME", "", "  "],
    )
    assert req.tags == ["beam", "frame"]


def test_schema_tag_count_is_capped():
    assert len(normalize_tags([f"tag{i}" for i in range(MAX_TAGS + 10)])) == MAX_TAGS


def test_schema_title_is_stripped_and_required():
    req = RegisterRequest(
        source_analysis_id=1, artifact_kind="modelbuilder_final", title="  제목  ",
    )
    assert req.title == "제목"
    with pytest.raises(ValueError):
        RegisterRequest(
            source_analysis_id=1, artifact_kind="modelbuilder_final", title="   ",
        )


def test_schema_rejects_unknown_artifact_kind():
    with pytest.raises(ValueError):
        RegisterRequest(
            source_analysis_id=1, artifact_kind="totally_unknown", title="T",
        )


def test_schema_does_not_accept_client_supplied_paths_or_identity():
    """절대경로·등록자 신원은 요청 스키마에 존재해서는 안 된다."""
    fields = set(RegisterRequest.model_fields)
    for forbidden in ("source_path", "bdf_path", "output_dir", "registered_by", "employee_id"):
        assert forbidden not in fields


def test_schema_patch_reports_only_supplied_fields():
    patch = ModelPatchRequest(title="새 제목")
    assert patch.model_dump(exclude_unset=True) == {"title": "새 제목"}


def test_schema_patch_normalizes_tags_but_keeps_none():
    assert ModelPatchRequest(tags=["  A ", "a"]).tags == ["a"]
    assert ModelPatchRequest().tags is None


# --------------------------------------------------------------------------- #
# REST API
#
# switchable_client 를 쓰는 이유: require_admin 을 스텁하지 않고 실제 DB is_admin
# 검사를 태워야 '비관리자는 403' 을 진짜로 검증할 수 있다.
# --------------------------------------------------------------------------- #

@pytest.fixture()
def registry_env(tmp_path, monkeypatch):
    """userConnection 과 registry root 를 tmp 로 갈아끼우고 엔진 폴백을 스텁한다."""
    user_conn = tmp_path / "userConnection"
    user_conn.mkdir()
    registry = tmp_path / "ModelRegistry"
    registry.mkdir()

    monkeypatch.setattr(
        "app.services.model_registry_service.USER_CONNECTION_DIR", str(user_conn),
    )
    monkeypatch.setenv("MODEL_REGISTRY_DIR", str(registry))
    # 실제 nastran_bridge 를 부르지 않도록 파서를 스텁한다(단위 테스트 격리).
    monkeypatch.setattr(
        "app.services.model_summary_service.parse_bdf_to_model_json",
        lambda path: {
            "meta": {"unit": "mm", "schemaVersion": "1.2"},
            "nodes": [{"id": 1, "x": 0.0, "y": 0.0, "z": 0.0}],
            "elements": [{"id": 1, "type": "CBEAM"}],
            "rigids": [], "properties": [], "materials": [], "pointMasses": [],
            "healthMetrics": {"issues": {}}, "elementQuality": {},
            "connectivity": {"groupCount": 1},
        },
    )
    return {"user_conn": user_conn, "registry": registry}


def _seed_source(db, registry_env, *, employee="EMP002", content=b"CEND\nENDDATA\n"):
    wd = registry_env["user_conn"] / f"20260728_120000_{employee}_HiTessModelBuilder"
    wd.mkdir(exist_ok=True)
    bdf = wd / f"model_{employee}.bdf"
    bdf.write_bytes(content)
    a = models.Analysis(
        program_name="HiTessModelBuilder",
        employee_id=employee,
        project_name="p",
        status="success",
        result_info={"bdf_path": str(bdf)},
        input_info={},
    )
    db.add(a)
    db.commit()
    return a


def _payload(analysis_id, **kw):
    body = {
        "source_analysis_id": analysis_id,
        "artifact_kind": "modelbuilder_final",
        "title": "기준 모델",
    }
    body.update(kw)
    return body


def _register(client, analysis_id, **kw):
    return client.post("/api/model-registry/models", json=_payload(analysis_id, **kw))


def test_api_admin_can_register_and_files_land_in_registry(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)

    res = _register(switchable_client, a.id)

    assert res.status_code == 201, res.text
    body = res.json()
    assert body["revision"] == 1
    assert body["status"] == "active"

    rev_dir = registry_env["registry"] / "models" / body["model_uid"] / "rev-0001"
    assert (rev_dir / "source.bdf").is_file()
    assert (rev_dir / "summary.json").is_file()
    assert (rev_dir / "manifest.json").is_file()


def test_api_registration_records_owner_and_registrar_separately(
    switchable_client, db_session, registry_env,
):
    """관리자가 타인 해석을 등록해도 owner 는 원 수행자로 남는다."""
    a = _seed_source(db_session, registry_env, employee="OTHER1")

    res = _register(switchable_client, a.id)
    assert res.status_code == 201, res.text

    model = (
        db_session.query(models.RegisteredModel)
        .filter(models.RegisteredModel.model_uid == res.json()["model_uid"])
        .first()
    )
    assert model.owner_id == "OTHER1"
    assert model.registered_by == "ADMIN001"


def test_api_non_admin_cannot_register(switchable_client, db_session, registry_env):
    a = _seed_source(db_session, registry_env)
    switchable_client.as_user()
    assert _register(switchable_client, a.id).status_code == 403
    assert db_session.query(models.RegisteredModel).count() == 0


def test_api_non_admin_cannot_preview(switchable_client, db_session, registry_env):
    a = _seed_source(db_session, registry_env)
    switchable_client.as_user()
    res = switchable_client.post(
        "/api/model-registry/preview",
        json={"source_analysis_id": a.id, "artifact_kind": "modelbuilder_final"},
    )
    assert res.status_code == 403


def test_api_preview_does_not_change_db_or_storage(
    switchable_client, db_session, registry_env,
):
    """★ preview 는 상태를 바꾸지 않는다."""
    a = _seed_source(db_session, registry_env)

    res = switchable_client.post(
        "/api/model-registry/preview",
        json={"source_analysis_id": a.id, "artifact_kind": "modelbuilder_final"},
    )

    assert res.status_code == 200, res.text
    assert db_session.query(models.RegisteredModel).count() == 0
    assert not (registry_env["registry"] / "models").exists()

    body = res.json()
    assert body["source"]["file_name"] == "model_EMP002.bdf"
    assert any(x["kind"] == "bdf" for x in body["available_artifacts"])
    # 원본 작업 폴더도 오염되지 않아야 한다(엔진 폴백은 임시 폴더에서 돈다).
    wd = registry_env["user_conn"] / "20260728_120000_EMP002_HiTessModelBuilder"
    assert [p.name for p in wd.iterdir()] == ["model_EMP002.bdf"]


def test_api_duplicate_registration_returns_409_with_existing_uid(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    first = _register(switchable_client, a.id)
    assert first.status_code == 201

    b = _seed_source(db_session, registry_env, employee="EMP003")
    again = _register(switchable_client, b.id, title="같은 BDF")

    assert again.status_code == 409
    detail = again.json()["detail"]
    assert detail["code"] == "EXACT_DUPLICATE"
    assert detail["model_uid"] == first.json()["model_uid"]
    assert detail["revision"] == 1


def test_api_preview_flags_duplicate(switchable_client, db_session, registry_env):
    a = _seed_source(db_session, registry_env)
    _register(switchable_client, a.id)

    res = switchable_client.post(
        "/api/model-registry/preview",
        json={"source_analysis_id": a.id, "artifact_kind": "modelbuilder_final"},
    )
    assert res.json()["duplicate"]["revision"] == 1


def test_api_expired_source_returns_409(switchable_client, db_session, registry_env):
    a = _seed_source(db_session, registry_env)
    os.remove((a.result_info or {})["bdf_path"])

    res = _register(switchable_client, a.id)

    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "SOURCE_EXPIRED"
    assert db_session.query(models.RegisteredModel).count() == 0


def test_api_storage_failure_leaves_no_active_row(
    switchable_client, db_session, registry_env, monkeypatch,
):
    """저장 실패 시 DB 에 등록 행이 남으면 안 된다."""
    a = _seed_source(db_session, registry_env)

    from app.services import model_registry_service as svc
    from app.services.model_registry_storage import StorageUnavailable

    def boom(**kwargs):
        raise StorageUnavailable("디스크 사용 불가")

    monkeypatch.setattr(svc, "publish_revision", boom)

    res = _register(switchable_client, a.id)

    assert res.status_code == 503
    assert db_session.query(models.RegisteredModel).count() == 0
    assert db_session.query(models.RegisteredModelRevision).count() == 0


def test_api_failed_analysis_can_be_registered(
    switchable_client, db_session, registry_env,
):
    """실패 모델도 회귀 예제로 등록 가능해야 한다."""
    wd = registry_env["user_conn"] / "20260728_120000_EMP002_HiTessModelBuilder"
    wd.mkdir(exist_ok=True)
    bdf = wd / "broken.bdf"
    bdf.write_bytes(b"CEND\n")
    a = models.Analysis(
        program_name="HiTessModelBuilder", employee_id="EMP002", project_name="p",
        status="failure", result_info={"bdf_path": str(bdf)}, input_info={},
    )
    db_session.add(a)
    db_session.commit()

    assert _register(switchable_client, a.id, model_role="failure").status_code == 201


def test_api_list_returns_envelope_and_company_models_for_regular_user(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    assert _register(switchable_client, a.id).status_code == 201

    switchable_client.as_user()
    res = switchable_client.get("/api/model-registry/models")

    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"total", "skip", "limit", "items"}
    assert body["total"] == 1
    assert body["items"][0]["title"] == "기준 모델"


def test_api_owner_visibility_hides_model_from_other_users(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env, employee="OTHER1")
    uid = _register(switchable_client, a.id, visibility="owner").json()["model_uid"]

    switchable_client.as_user()
    assert switchable_client.get("/api/model-registry/models").json()["total"] == 0
    # 존재 여부 자체를 노출하지 않는다.
    assert switchable_client.get(
        f"/api/model-registry/models/{uid}",
    ).status_code == 404


def test_api_search_and_filters_are_applied_server_side(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    _register(switchable_client, a.id, title="권상 기준 모델", model_type="module-unit")

    def total(**params):
        return switchable_client.get(
            "/api/model-registry/models", params=params,
        ).json()["total"]

    assert total(query="권상") == 1
    assert total(query="없는말") == 0
    assert total(model_type="beam-frame") == 0
    assert total(model_type="module-unit") == 1
    assert total(source_program="HiTessModelBuilder") == 1
    assert total(source_program="GroupModuleUnit") == 0


def test_api_archive_hides_from_default_list_but_keeps_files(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    assert switchable_client.post(
        f"/api/model-registry/models/{uid}/archive",
    ).status_code == 200

    assert switchable_client.get("/api/model-registry/models").json()["total"] == 0
    assert switchable_client.get(
        "/api/model-registry/models", params={"status": "archived"},
    ).json()["total"] == 1
    assert (
        registry_env["registry"] / "models" / uid / "rev-0001" / "source.bdf"
    ).is_file()


def test_api_archived_duplicate_is_distinguishable_from_active_duplicate(
    switchable_client, db_session, registry_env,
):
    """보관 후 재등록은 막히되, '복원하면 된다'는 걸 알 수 있는 코드로 막혀야 한다.

    bdf_sha256 이 전역 unique 라 보관된 모델과 같은 BDF 는 재등록할 수 없다.
    두 경우를 같은 EXACT_DUPLICATE 로 뭉뚱그리면 사용자는 빠져나갈 길이 없다.
    """
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]
    switchable_client.post(f"/api/model-registry/models/{uid}/archive")

    b = _seed_source(db_session, registry_env, employee="EMP004")
    again = _register(switchable_client, b.id, title="다시 등록 시도")

    assert again.status_code == 409
    detail = again.json()["detail"]
    assert detail["code"] == "ARCHIVED_DUPLICATE"
    assert detail["model_uid"] == uid
    assert detail["model_status"] == "archived"


def test_api_preview_reports_duplicate_status(
    switchable_client, db_session, registry_env,
):
    """preview 도 보관 여부를 알려줘야 모달이 '복원' 을 제안할 수 있다."""
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    def preview():
        return switchable_client.post(
            "/api/model-registry/preview",
            json={"source_analysis_id": a.id, "artifact_kind": "modelbuilder_final"},
        ).json()["duplicate"]

    assert preview()["status"] == "active"

    switchable_client.post(f"/api/model-registry/models/{uid}/archive")
    assert preview()["status"] == "archived"


def test_api_restore_brings_archived_model_back_to_list(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]
    switchable_client.post(f"/api/model-registry/models/{uid}/archive")
    assert switchable_client.get("/api/model-registry/models").json()["total"] == 0

    res = switchable_client.post(f"/api/model-registry/models/{uid}/restore")

    assert res.status_code == 200, res.text
    assert res.json()["status"] == "active"
    assert switchable_client.get("/api/model-registry/models").json()["total"] == 1
    # 보관 중에도 파일은 그대로였으므로 복원 후 다운로드가 계속 가능해야 한다.
    artifact = res.json()["revisions"][0]["artifacts"][0]
    assert switchable_client.get(
        f"/api/model-registry/artifacts/{artifact['id']}/download",
    ).status_code == 200


def test_api_new_revision_reactivates_archived_target_model(
    switchable_client, db_session, registry_env,
):
    """보관된 모델에 revision 을 붙이면 201 인데 목록엔 안 보이는 상황을 막는다."""
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]
    switchable_client.post(f"/api/model-registry/models/{uid}/archive")

    b = _seed_source(db_session, registry_env, employee="EMP005")
    # 내용이 달라야 sha256 이 겹치지 않는다 — 같은 모델의 다음 revision 을 흉내낸다.
    with open((b.result_info or {})["bdf_path"], "ab") as f:
        f.write(b"$ revision 2\n")

    res = switchable_client.post(
        "/api/model-registry/models",
        json={**_payload(b.id, title="다음 revision"), "target_model_uid": uid},
    )

    assert res.status_code == 201, res.text
    assert res.json()["revision"] == 2
    assert res.json()["status"] == "active"
    assert switchable_client.get("/api/model-registry/models").json()["total"] == 1


def test_api_restore_is_idempotent(switchable_client, db_session, registry_env):
    """이미 active 인 모델에 restore 를 다시 눌러도 안전해야 한다."""
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    first = switchable_client.post(f"/api/model-registry/models/{uid}/restore")
    second = switchable_client.post(f"/api/model-registry/models/{uid}/restore")

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["status"] == "active"
    assert len(second.json()["revisions"]) == 1


def test_api_non_admin_cannot_restore(switchable_client, db_session, registry_env):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]
    switchable_client.post(f"/api/model-registry/models/{uid}/archive")

    switchable_client.as_user()
    res = switchable_client.post(f"/api/model-registry/models/{uid}/restore")

    assert res.status_code == 403


def test_api_patch_updates_metadata_without_new_revision(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    res = switchable_client.patch(
        f"/api/model-registry/models/{uid}", json={"title": "새 제목", "tags": ["  Ref "]},
    )

    assert res.status_code == 200, res.text
    assert res.json()["title"] == "새 제목"
    assert res.json()["tags"] == ["ref"]
    assert len(res.json()["revisions"]) == 1


def test_api_q4_only_via_explicit_approval(
    switchable_client, db_session, registry_env,
):
    """Q4(Golden)는 자동 부여되지 않고 명시적 승인에서만 올라간다."""
    a = _seed_source(db_session, registry_env)
    created = _register(switchable_client, a.id).json()
    assert created["quality_level"] != "Q4"

    res = switchable_client.patch(
        f"/api/model-registry/models/{created['model_uid']}",
        json={"review_status": "approved"},
    )
    assert res.json()["revisions"][0]["quality_level"] == "Q4"
    assert res.json()["revisions"][0]["review_status"] == "approved"


def test_api_non_admin_cannot_patch_or_archive(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    switchable_client.as_user()
    assert switchable_client.patch(
        f"/api/model-registry/models/{uid}", json={"title": "탈취"},
    ).status_code == 403
    assert switchable_client.post(
        f"/api/model-registry/models/{uid}/archive",
    ).status_code == 403


def test_api_artifact_download_serves_registered_file(
    switchable_client, db_session, registry_env,
):
    payload = b"CEND\nBEGIN BULK\nENDDATA\n"
    a = _seed_source(db_session, registry_env, content=payload)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    detail = switchable_client.get(f"/api/model-registry/models/{uid}").json()
    bdf = next(x for x in detail["revisions"][0]["artifacts"] if x["kind"] == "bdf")

    res = switchable_client.get(f"/api/model-registry/artifacts/{bdf['id']}/download")

    assert res.status_code == 200
    assert res.content == payload
    assert bdf["size_bytes"] == len(payload)


def test_api_download_rejects_unreadable_model(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env, employee="OTHER1")
    uid = _register(switchable_client, a.id, visibility="owner").json()["model_uid"]
    detail = switchable_client.get(f"/api/model-registry/models/{uid}").json()
    artifact_id = detail["revisions"][0]["artifacts"][0]["id"]

    switchable_client.as_user()
    assert switchable_client.get(
        f"/api/model-registry/artifacts/{artifact_id}/download",
    ).status_code == 404


def test_api_download_rejects_unknown_artifact_id(switchable_client, registry_env):
    assert switchable_client.get(
        "/api/model-registry/artifacts/999999/download",
    ).status_code == 404


def test_api_download_refuses_path_escaping_registry_root(
    switchable_client, db_session, registry_env, tmp_path,
):
    """DB relative_path 가 오염돼도 저장소 밖 파일은 서빙하지 않는다."""
    a = _seed_source(db_session, registry_env)
    _register(switchable_client, a.id)

    secret = tmp_path / "secret.txt"
    secret.write_text("탈취 대상", encoding="utf-8")

    artifact = db_session.query(models.RegisteredModelArtifact).first()
    artifact.relative_path = "../secret.txt"
    db_session.commit()

    assert switchable_client.get(
        f"/api/model-registry/artifacts/{artifact.id}/download",
    ).status_code == 404


def test_api_registration_is_audit_logged(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    _register(switchable_client, a.id)

    logs = (
        db_session.query(models.ActivityLog)
        .filter(models.ActivityLog.action_type == "MODEL_REGISTER")
        .all()
    )
    assert len(logs) == 1
    assert logs[0].employee_id == "ADMIN001"


def test_api_browsing_is_not_audit_logged(switchable_client, registry_env, db_session):
    """검색/필터는 감사 로그에 남기지 않는다(audit-log-policy)."""
    switchable_client.get("/api/model-registry/models", params={"query": "x"})
    assert db_session.query(models.ActivityLog).count() == 0


def test_api_second_revision_of_same_model(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    b = _seed_source(
        db_session, registry_env, employee="EMP004", content=b"CEND\nV2\n",
    )
    res = _register(switchable_client, b.id, target_model_uid=uid, title="개정본")

    assert res.status_code == 201, res.text
    assert res.json()["revision"] == 2
    assert res.json()["model_uid"] == uid

    detail = switchable_client.get(f"/api/model-registry/models/{uid}").json()
    assert [r["revision_no"] for r in detail["revisions"]] == [2, 1]


def test_api_summary_json_written_to_disk_matches_db(
    switchable_client, db_session, registry_env,
):
    import json

    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    on_disk = json.loads(
        (registry_env["registry"] / "models" / uid / "rev-0001" / "summary.json")
        .read_text(encoding="utf-8")
    )
    revision = db_session.query(models.RegisteredModelRevision).first()

    assert on_disk["schemaVersion"] == SUMMARY_SCHEMA_VERSION
    assert on_disk["provenance"]["registeredBy"] == "ADMIN001"
    assert on_disk["provenance"]["ownerId"] == "EMP002"
    assert revision.summary_json["geometry"] == on_disk["geometry"]
    # artifactId 는 디스크 summary 에 넣지 않는다(자기참조 순환 방지).
    assert "artifacts" not in on_disk


def test_api_manifest_lists_every_stored_file(
    switchable_client, db_session, registry_env,
):
    import json

    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    rev_dir = registry_env["registry"] / "models" / uid / "rev-0001"
    manifest = json.loads((rev_dir / "manifest.json").read_text(encoding="utf-8"))

    listed = {f["file_name"] for f in manifest["files"]}
    assert listed == {"source.bdf", "summary.json"}
    for entry in manifest["files"]:
        assert not os.path.isabs(entry["relative_path"])
        assert len(entry["sha256"]) == 64


# --------------------------------------------------------------------------- #
# Insight API
# --------------------------------------------------------------------------- #

def test_api_insights_empty_registry_returns_null_stats(switchable_client, registry_env):
    res = switchable_client.get("/api/model-registry/insights/overview")

    assert res.status_code == 200
    body = res.json()
    assert body["totals"]["revisions"] == 0
    assert body["metrics"]["nodeCount"]["sampleSize"] == 0
    assert body["metrics"]["nodeCount"]["mean"] is None, "표본이 없으면 0 이 아니라 null"


def test_api_insights_reflects_registered_models(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    _register(switchable_client, a.id, model_type="module-unit", tags=["lifting"])

    body = switchable_client.get("/api/model-registry/insights/overview").json()

    assert body["totals"]["revisions"] == 1
    assert body["totals"]["models"] == 1
    programs = {d["key"]: d["count"] for d in body["distributions"]["sourceProgram"]}
    assert programs["HiTessModelBuilder"] == 1
    assert body["metrics"]["nodeCount"]["sampleSize"] == 1
    assert {t["tag"] for t in body["topTags"]} == {"lifting"}


def test_api_insights_respects_visibility(switchable_client, db_session, registry_env):
    """비공개 모델은 다른 사용자의 통계에 잡히면 안 된다."""
    a = _seed_source(db_session, registry_env, employee="OTHER1")
    _register(switchable_client, a.id, visibility="owner")

    assert switchable_client.get(
        "/api/model-registry/insights/overview",
    ).json()["totals"]["revisions"] == 1

    switchable_client.as_user()
    assert switchable_client.get(
        "/api/model-registry/insights/overview",
    ).json()["totals"]["revisions"] == 0


def test_api_insights_separates_quality_from_design_outcome(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]
    switchable_client.patch(
        f"/api/model-registry/models/{uid}", json={"review_status": "approved"},
    )

    totals = switchable_client.get(
        "/api/model-registry/insights/overview",
    ).json()["totals"]

    # 승인(Q4)은 품질 축, designPass 는 설계 축 — 별도 키로 나온다.
    assert totals["goldenApproved"] == 1
    assert "designPass" in totals


def test_api_export_excludes_employee_ids_by_default(
    switchable_client, db_session, registry_env,
):
    """★ 기본 export 에 사번이 없어야 한다."""
    a = _seed_source(db_session, registry_env, employee="OTHER1")
    _register(switchable_client, a.id)

    body = switchable_client.get("/api/model-registry/export.json").json()

    assert body["count"] == 1
    assert body["includesIdentity"] is False
    assert "owner_id" not in body["rows"][0]
    assert "OTHER1" not in str(body["rows"][0])
    assert "ADMIN001" not in str(body["rows"][0])


def test_api_export_identity_requires_admin(switchable_client, db_session, registry_env):
    a = _seed_source(db_session, registry_env)
    _register(switchable_client, a.id)

    admin_body = switchable_client.get(
        "/api/model-registry/export.json", params={"include_identity": "true"},
    ).json()
    assert admin_body["rows"][0]["registered_by"] == "ADMIN001"

    switchable_client.as_user()
    res = switchable_client.get(
        "/api/model-registry/export.json", params={"include_identity": "true"},
    )
    assert res.status_code == 403


# --------------------------------------------------------------------------- #
# E2E 실패 매트릭스 — 계획서 Task 11
# --------------------------------------------------------------------------- #

def _seed_gmu_source(db, registry_env, *, employee="EMP002"):
    """GroupModuleUnit 작업 폴더 — parent BDF + _edited/_lifting 산출물."""
    wd = registry_env["user_conn"] / f"20260728_130000_{employee}_GroupModuleUnit"
    wd.mkdir(exist_ok=True)
    parent = wd / "unit.bdf"
    parent.write_bytes(b"CEND\nPARENT\n")
    (wd / "unit_edited.bdf").write_bytes(b"CEND\nEDITED\n")
    (wd / "unit_lifting.bdf").write_bytes(b"CEND\nLIFTING\n")
    a = models.Analysis(
        program_name="GroupModuleUnit",
        employee_id=employee,
        project_name="gmu",
        status="success",
        input_info={"bdf_model": str(parent)},
        result_info={},
    )
    db.add(a)
    db.commit()
    return a


@pytest.mark.parametrize(
    "artifact_kind,expected_body",
    [
        ("module_unit_edited", b"CEND\nEDITED\n"),
        ("module_unit_lifting", b"CEND\nLIFTING\n"),
    ],
)
def test_api_module_unit_edited_and_lifting_register_as_distinct_artifacts(
    switchable_client, db_session, registry_env, artifact_kind, expected_body,
):
    """_edited.bdf 와 _lifting.bdf 는 의미가 달라 각각 다른 파일이 등록되어야 한다."""
    a = _seed_gmu_source(db_session, registry_env)

    res = switchable_client.post(
        "/api/model-registry/models",
        json={
            "source_analysis_id": a.id,
            "artifact_kind": artifact_kind,
            "title": f"GMU {artifact_kind}",
        },
    )

    assert res.status_code == 201, res.text
    uid = res.json()["model_uid"]

    detail = switchable_client.get(f"/api/model-registry/models/{uid}").json()
    revision = detail["revisions"][0]
    assert revision["source_artifact_kind"] == artifact_kind

    bdf = next(x for x in revision["artifacts"] if x["kind"] == "bdf")
    dl = switchable_client.get(f"/api/model-registry/artifacts/{bdf['id']}/download")
    assert dl.content == expected_body


def test_api_summary_only_registration_keeps_model_searchable(
    switchable_client, db_session, registry_env,
):
    """BDF 본문 없이 요약만 등록해도 검색·중복판정이 되어야 한다."""
    a = _seed_source(db_session, registry_env)

    res = switchable_client.post(
        "/api/model-registry/models",
        json=_payload(a.id, include_artifacts=["summary"]),
    )

    assert res.status_code == 201, res.text
    uid = res.json()["model_uid"]

    rev_dir = registry_env["registry"] / "models" / uid / "rev-0001"
    assert (rev_dir / "summary.json").is_file()
    assert not (rev_dir / "source.bdf").exists(), "BDF 를 선택하지 않았는데 저장되면 안 된다"

    detail = switchable_client.get(f"/api/model-registry/models/{uid}").json()
    kinds = {x["kind"] for x in detail["revisions"][0]["artifacts"]}
    assert "bdf" not in kinds
    # 체크섬은 여전히 기록되어 중복 등록을 막는다.
    assert len(detail["revisions"][0]["bdf_sha256"]) == 64
    assert switchable_client.get(
        "/api/model-registry/models", params={"query": "기준"},
    ).json()["total"] == 1


def test_api_db_commit_failure_removes_published_files(
    switchable_client, db_session, registry_env, monkeypatch,
):
    """★ 파일은 확정됐는데 DB commit 이 실패하면 파일을 되돌린다(보상 트랜잭션)."""
    a = _seed_source(db_session, registry_env)

    def exploding_commit():
        raise RuntimeError("DB 연결이 끊어졌습니다")

    monkeypatch.setattr(db_session, "commit", exploding_commit)

    res = switchable_client.post("/api/model-registry/models", json=_payload(a.id))

    assert res.status_code == 500
    assert res.json()["detail"]["code"] == "REGISTRY_COMMIT_FAILED"
    # 발행된 revision 이 orphan 으로 남지 않아야 한다(빈 모델 폴더도 남기지 않는다).
    models_root = registry_env["registry"] / "models"
    leftovers = list(models_root.rglob("*")) if models_root.exists() else []
    assert leftovers == [], f"보상 후 잔여 파일/폴더: {leftovers}"


def test_api_responses_never_leak_absolute_storage_paths(
    switchable_client, db_session, registry_env,
):
    """★ 절대경로/UNC 경로가 API 응답에 새어 나가면 안 된다."""
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    for path in (
        "/api/model-registry/models",
        f"/api/model-registry/models/{uid}",
        "/api/model-registry/export.json",
        "/api/model-registry/insights/overview",
    ):
        blob = switchable_client.get(path).text
        assert str(registry_env["registry"]) not in blob, f"{path} 가 저장소 절대경로를 노출한다"
        assert str(registry_env["user_conn"]) not in blob, f"{path} 가 userConnection 경로를 노출한다"
        assert "\\\\storage.hpc" not in blob


def test_api_registration_payload_ignores_unknown_path_fields(
    switchable_client, db_session, registry_env, tmp_path,
):
    """클라이언트가 경로를 끼워 넣어도 서버는 무시하고 자체 해석한 파일을 쓴다."""
    a = _seed_source(db_session, registry_env, content=b"CEND\nREAL\n")
    evil = tmp_path / "evil.bdf"
    evil.write_bytes(b"CEND\nEVIL\n")

    res = switchable_client.post(
        "/api/model-registry/models",
        json=_payload(a.id, source_path=str(evil), bdf_path=str(evil), registered_by="HACKER"),
    )

    assert res.status_code == 201, res.text
    uid = res.json()["model_uid"]

    stored = (registry_env["registry"] / "models" / uid / "rev-0001" / "source.bdf").read_bytes()
    assert stored == b"CEND\nREAL\n", "클라이언트가 지정한 파일이 저장되면 안 된다"

    model = (
        db_session.query(models.RegisteredModel)
        .filter(models.RegisteredModel.model_uid == uid)
        .first()
    )
    assert model.registered_by == "ADMIN001", "요청의 registered_by 를 신뢰하면 안 된다"




# --------------------------------------------------------------------------- #
# 3D 미리보기 지오메트리
# --------------------------------------------------------------------------- #

def test_api_geometry_returns_coordinates_without_exposing_paths(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    res = switchable_client.get(f"/api/model-registry/models/{uid}/geometry")
    assert res.status_code == 200
    body = res.json()

    assert body["model_uid"] == uid
    assert body["revision"] == 1
    assert body["nodes"]["1"] == [0.0, 0.0, 0.0]
    # 좌표만 나간다 — 저장소 경로가 새어 나오면 안 된다.
    blob = res.text
    assert str(registry_env["registry"]) not in blob
    assert "relative_path" not in blob


def test_api_geometry_is_readable_by_non_admin(
    switchable_client, db_session, registry_env,
):
    """등록은 관리자 전용이지만 미리보기는 전사 공개 모델이므로 누구나 본다."""
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    switchable_client.as_user()
    res = switchable_client.get(f"/api/model-registry/models/{uid}/geometry")
    assert res.status_code == 200


def test_api_geometry_hides_models_the_user_cannot_read(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env, employee="OTHER1")
    uid = _register(switchable_client, a.id, visibility="owner").json()["model_uid"]

    switchable_client.as_user()
    res = switchable_client.get(f"/api/model-registry/models/{uid}/geometry")
    assert res.status_code == 404


def test_api_geometry_404_for_unknown_revision(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    res = switchable_client.get(
        f"/api/model-registry/models/{uid}/geometry", params={"revision": 99},
    )
    assert res.status_code == 404


# --------------------------------------------------------------------------- #
# summary 가 파일 내용을 화면으로 끌어올린다
# --------------------------------------------------------------------------- #

def test_api_preview_summary_carries_readable_sections(
    switchable_client, db_session, registry_env,
):
    """입력 감사·단계 요약 절이 응답에 존재해야 프론트가 '없음'과 '이전 스키마'를 구분한다."""
    a = _seed_source(db_session, registry_env)
    res = switchable_client.post(
        "/api/model-registry/preview",
        json={"source_analysis_id": a.id, "artifact_kind": "modelbuilder_final"},
    )
    assert res.status_code == 200
    summary = res.json()["summary"]
    for key in ("inputAudit", "buildStages", "diagnostics"):
        assert key in summary


# --------------------------------------------------------------------------- #
# 유사 모델 검색 (Knowledge Retrieval)
# --------------------------------------------------------------------------- #

def test_api_similar_excludes_self_and_explains_its_basis(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env, employee="EMP002")
    b = _seed_source(db_session, registry_env, employee="EMP003")
    uid_a = _register(switchable_client, a.id, title="A").json()["model_uid"]
    _register(switchable_client, b.id, title="B")

    res = switchable_client.get(f"/api/model-registry/models/{uid_a}/similar")
    assert res.status_code == 200
    body = res.json()

    assert all(item["model_uid"] != uid_a for item in body["items"]), "자기 자신은 제외한다"
    # 총점만 주는 API 는 만들지 않는다 — 근거가 항상 함께 나가야 한다.
    assert body["dimensions"]
    for item in body["items"]:
        assert "basis" in item and "skipped" in item


def test_api_similar_is_readable_by_non_admin(switchable_client, db_session, registry_env):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    switchable_client.as_user()
    assert switchable_client.get(
        f"/api/model-registry/models/{uid}/similar"
    ).status_code == 200


def test_api_similar_hides_models_the_user_cannot_read(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env, employee="OTHER1")
    uid = _register(switchable_client, a.id, visibility="owner").json()["model_uid"]

    switchable_client.as_user()
    assert switchable_client.get(
        f"/api/model-registry/models/{uid}/similar"
    ).status_code == 404


def test_api_similar_does_not_leak_storage_paths(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    res = switchable_client.get(f"/api/model-registry/models/{uid}/similar")
    assert str(registry_env["registry"]) not in res.text
    assert "storage_relative_path" not in res.text


def test_api_insights_expose_cohort_and_split_diagnostics(
    switchable_client, db_session, registry_env,
):
    """'전체 표본'과 '학습에 쓸 수 있는 표본'은 다르다 — 둘 다 나가야 한다."""
    a = _seed_source(db_session, registry_env)
    _register(switchable_client, a.id)

    body = switchable_client.get("/api/model-registry/insights/overview").json()
    readiness = body["datasetReadiness"]
    assert "trainableCohort" in readiness
    assert "extractorVersion" in readiness
    # 피처 커버리지는 '해당 없음'을 결측과 분리해 보고한다.
    assert all("notApplicable" in f for f in readiness["features"])
