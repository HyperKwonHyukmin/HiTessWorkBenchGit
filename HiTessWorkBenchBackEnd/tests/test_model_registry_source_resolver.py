"""Model Registry — 서버 측 source resolver 테스트.

핵심 계약:
- 클라이언트가 경로를 보내지 않고, 서버가 allowlist 로 해석한다.
- 해석된 경로는 반드시 userConnection 하위여야 한다.
- 30일 정리로 파일이 사라지면 409 SOURCE_EXPIRED.
- 등록은 관리자 전용이므로 resolver 는 소유권을 막지 않고, 원 수행자를 owner_id 로 돌려준다.
"""
import os

import pytest

from app import models
from app.model_registry_schemas import SourceArtifactKind
from app.services.model_registry_service import (
    SourceResolutionError,
    resolve_source,
)


@pytest.fixture()
def user_conn(tmp_path, monkeypatch):
    """userConnection 루트를 tmp 로 갈아끼운다.

    resolver 는 import 시점에 상수를 바인딩하므로 모듈 속성을 직접 패치한다.
    """
    root = tmp_path / "userConnection"
    root.mkdir()
    monkeypatch.setattr(
        "app.services.model_registry_service.USER_CONNECTION_DIR", str(root),
    )
    return root


def _workdir(user_conn, name="20260728_120000_EMP001_HiTessModelBuilder"):
    d = user_conn / name
    d.mkdir(exist_ok=True)
    return d


def _bdf(folder, name="model.bdf", text="CEND\n"):
    p = folder / name
    p.write_text(text, encoding="utf-8")
    return str(p)


def _analysis(db, *, program, employee="EMP001", result=None, input_info=None):
    a = models.Analysis(
        program_name=program,
        employee_id=employee,
        project_name="p",
        status="success",
        result_info=result or {},
        input_info=input_info or {},
    )
    db.add(a)
    db.commit()
    return a


# --------------------------------------------------------------------------- #
# allowlist: program × artifact_kind
# --------------------------------------------------------------------------- #

def test_modelbuilder_final_resolves_bdf_path(db_session, user_conn):
    wd = _workdir(user_conn)
    bdf = _bdf(wd)
    a = _analysis(db_session, program="HiTessModelBuilder", result={"bdf_path": bdf})

    resolved = resolve_source(db_session, a.id, SourceArtifactKind.MODELBUILDER_FINAL)

    assert resolved.bdf_path == os.path.abspath(bdf)
    assert resolved.file_name == "model.bdf"
    assert resolved.owner_id == "EMP001"
    assert resolved.program_name == "HiTessModelBuilder"


def test_modelbuilder_final_collects_companion_artifacts(db_session, user_conn):
    wd = _workdir(user_conn)
    bdf = _bdf(wd)
    model_json = wd / "model.json"
    model_json.write_text("{}", encoding="utf-8")
    a = _analysis(
        db_session,
        program="HiTessModelBuilder",
        result={"bdf_path": bdf, "json_path": str(model_json)},
    )

    resolved = resolve_source(db_session, a.id, SourceArtifactKind.MODELBUILDER_FINAL)

    assert resolved.companions["normalized-model"] == os.path.abspath(str(model_json))


def test_modelbuilder_edited_scans_edited_subfolder(db_session, user_conn):
    wd = _workdir(user_conn)
    edited = wd / "edited"
    edited.mkdir()
    edited_bdf = _bdf(edited, "model_edit.bdf")
    a = _analysis(
        db_session, program="HiTessModelBuilder", result={"output_dir": str(wd)},
    )

    resolved = resolve_source(db_session, a.id, SourceArtifactKind.MODELBUILDER_EDITED)

    assert resolved.bdf_path == os.path.abspath(edited_bdf)


def test_modelbuilder_solved_resolves_bdf_key(db_session, user_conn):
    wd = _workdir(user_conn, "20260728_120000_EMP001_ModelBuilderAnalysis")
    bdf = _bdf(wd, "solved_model.bdf")
    a = _analysis(db_session, program="ModelBuilderAnalysis", result={"bdf": bdf})

    resolved = resolve_source(db_session, a.id, SourceArtifactKind.MODELBUILDER_SOLVED)

    assert resolved.bdf_path == os.path.abspath(bdf)


def test_groupmodule_original_resolves_from_input_info(db_session, user_conn):
    """GMU 계열에서 실행 단계와 무관하게 안정적인 앵커는 input_info['bdf_model'] 뿐이다."""
    wd = _workdir(user_conn, "20260728_120000_EMP001_GroupModuleUnit")
    bdf = _bdf(wd)
    a = _analysis(
        db_session, program="GroupModuleUnit", input_info={"bdf_model": bdf},
    )

    resolved = resolve_source(db_session, a.id, SourceArtifactKind.GROUPMODULE_ORIGINAL)

    assert resolved.bdf_path == os.path.abspath(bdf)


@pytest.mark.parametrize(
    "kind,suffix",
    [
        (SourceArtifactKind.MODULE_UNIT_EDITED, "_edited.bdf"),
        (SourceArtifactKind.MODULE_UNIT_LIFTING, "_lifting.bdf"),
    ],
)
def test_module_unit_edited_and_lifting_are_distinct_artifacts(
    db_session, user_conn, kind, suffix,
):
    """_edited.bdf 와 _lifting.bdf 는 의미가 다르므로 kind 별로 다른 파일이 나와야 한다."""
    wd = _workdir(user_conn, "20260728_120000_EMP001_GroupModuleUnit")
    parent = _bdf(wd)
    _bdf(wd, "model_edited.bdf")
    _bdf(wd, "model_lifting.bdf")
    a = _analysis(
        db_session, program="GroupModuleUnit", input_info={"bdf_model": parent},
    )

    resolved = resolve_source(db_session, a.id, kind)

    assert resolved.bdf_path.endswith(suffix)


def test_module_unit_lifting_from_unit_structural_result(db_session, user_conn):
    wd = _workdir(user_conn, "20260728_120000_EMP001_GroupModuleUnit")
    lifting = _bdf(wd, "model_lifting.bdf")
    a = _analysis(
        db_session,
        program="UnitStructuralAnalysis",
        result={"liftingBdf": lifting},
    )

    resolved = resolve_source(db_session, a.id, SourceArtifactKind.MODULE_UNIT_LIFTING)

    assert resolved.bdf_path == os.path.abspath(lifting)


def test_failed_analysis_can_still_be_registered(db_session, user_conn):
    """실패/FATAL 모델도 회귀 예제로 가치가 있으므로 status 로 막지 않는다."""
    wd = _workdir(user_conn)
    bdf = _bdf(wd)
    a = models.Analysis(
        program_name="HiTessModelBuilder",
        employee_id="EMP001",
        project_name="p",
        status="failure",
        result_info={"bdf_path": bdf},
        input_info={},
    )
    db_session.add(a)
    db_session.commit()

    resolved = resolve_source(db_session, a.id, SourceArtifactKind.MODELBUILDER_FINAL)

    assert resolved.bdf_path == os.path.abspath(bdf)


# --------------------------------------------------------------------------- #
# 거부 케이스
# --------------------------------------------------------------------------- #

def test_unknown_analysis_returns_not_found(db_session, user_conn):
    with pytest.raises(SourceResolutionError) as exc:
        resolve_source(db_session, 99999, SourceArtifactKind.MODELBUILDER_FINAL)
    assert exc.value.code == "SOURCE_ANALYSIS_NOT_FOUND"
    assert exc.value.status_code == 404


def test_program_artifact_kind_mismatch_is_rejected(db_session, user_conn):
    wd = _workdir(user_conn, "20260728_120000_EMP001_GroupModuleUnit")
    bdf = _bdf(wd)
    a = _analysis(
        db_session, program="GroupModuleUnit", input_info={"bdf_model": bdf},
    )

    with pytest.raises(SourceResolutionError) as exc:
        resolve_source(db_session, a.id, SourceArtifactKind.MODELBUILDER_FINAL)
    assert exc.value.code == "UNSUPPORTED_ARTIFACT_KIND"
    assert exc.value.status_code == 400


def test_missing_file_reports_source_expired(db_session, user_conn):
    """DB 레코드는 남았는데 30일 정리로 파일이 사라진 상태."""
    wd = _workdir(user_conn)
    a = _analysis(
        db_session,
        program="HiTessModelBuilder",
        result={"bdf_path": str(wd / "gone.bdf")},
    )

    with pytest.raises(SourceResolutionError) as exc:
        resolve_source(db_session, a.id, SourceArtifactKind.MODELBUILDER_FINAL)
    assert exc.value.code == "SOURCE_EXPIRED"
    assert exc.value.status_code == 409


def test_path_outside_userconnection_is_rejected(db_session, user_conn, tmp_path):
    """DB 값이 오염되어도 userConnection 밖 파일은 registry 로 복사되지 않는다."""
    outside = tmp_path / "secret.bdf"
    outside.write_text("CEND\n", encoding="utf-8")
    a = _analysis(
        db_session, program="HiTessModelBuilder", result={"bdf_path": str(outside)},
    )

    with pytest.raises(SourceResolutionError) as exc:
        resolve_source(db_session, a.id, SourceArtifactKind.MODELBUILDER_FINAL)
    assert exc.value.code == "SOURCE_FORBIDDEN"


def test_path_traversal_is_rejected(db_session, user_conn, tmp_path):
    outside = tmp_path / "secret.bdf"
    outside.write_text("CEND\n", encoding="utf-8")
    traversal = str(user_conn / ".." / "secret.bdf")
    a = _analysis(
        db_session, program="HiTessModelBuilder", result={"bdf_path": traversal},
    )

    with pytest.raises(SourceResolutionError) as exc:
        resolve_source(db_session, a.id, SourceArtifactKind.MODELBUILDER_FINAL)
    assert exc.value.code == "SOURCE_FORBIDDEN"


def test_non_bdf_extension_is_rejected(db_session, user_conn):
    wd = _workdir(user_conn)
    txt = wd / "notes.txt"
    txt.write_text("hello", encoding="utf-8")
    a = _analysis(
        db_session, program="HiTessModelBuilder", result={"bdf_path": str(txt)},
    )

    with pytest.raises(SourceResolutionError) as exc:
        resolve_source(db_session, a.id, SourceArtifactKind.MODELBUILDER_FINAL)
    assert exc.value.code == "UNSUPPORTED_ARTIFACT_KIND"


def test_companion_outside_userconnection_is_dropped(db_session, user_conn, tmp_path):
    """부가 artifact 도 동일한 격리 규칙을 받는다."""
    wd = _workdir(user_conn)
    bdf = _bdf(wd)
    outside = tmp_path / "elsewhere.json"
    outside.write_text("{}", encoding="utf-8")
    a = _analysis(
        db_session,
        program="HiTessModelBuilder",
        result={"bdf_path": bdf, "json_path": str(outside)},
    )

    resolved = resolve_source(db_session, a.id, SourceArtifactKind.MODELBUILDER_FINAL)

    assert "normalized-model" not in resolved.companions


def test_admin_can_resolve_another_users_analysis(db_session, user_conn):
    """관리자 큐레이션 전제 — 타인 해석도 해석 가능하되 owner_id 는 원 수행자로 남는다."""
    wd = _workdir(user_conn, "20260728_120000_OTHER1_HiTessModelBuilder")
    bdf = _bdf(wd)
    a = _analysis(
        db_session, program="HiTessModelBuilder", employee="OTHER1",
        result={"bdf_path": bdf},
    )

    resolved = resolve_source(db_session, a.id, SourceArtifactKind.MODELBUILDER_FINAL)

    assert resolved.owner_id == "OTHER1"
