"""Model Builder 입력 CSV 보관(mb_csv_archive) 시험."""
import csv
import os

import pytest

from app.services import mb_csv_archive as arc


def _write(path, text: str = "name,pos\nA,1\n", raw: bytes | None = None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(raw if raw is not None else text.encode("utf-8"))
    return str(path)


def _manifest(root):
    with open(os.path.join(root, arc.MANIFEST_NAME), encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


@pytest.fixture
def dirs(tmp_path):
    return tmp_path / "userConnection", tmp_path / "archive"


def test_same_content_is_stored_once(dirs):
    uc, root = dirs
    a = _write(uc / "20261027_103007_A476854_HiTessModelBuilder" / "3592-35040-struData-A.csv")
    b = _write(uc / "20261028_090000_A123456_AmToModelBuilder" / "3592-35040-struData-A.csv")

    assert arc.archive_csv(a, source_folder="f1", root=str(root)) == "stored"
    assert arc.archive_csv(b, source_folder="f2", root=str(root)) == "duplicate"

    stored = list((root / "3592").glob("*.csv"))
    assert len(stored) == 1
    rows = _manifest(root)
    assert [r["source_folder"] for r in rows] == ["f1", "f2"]
    assert rows[0]["stored_path"] == rows[1]["stored_path"] == "3592/3592-35040-struData-A.csv"
    assert rows[0]["kind"] == "stru" and rows[0]["hull_no"] == "3592"


def test_rerun_is_safe(dirs):
    uc, root = dirs
    a = _write(uc / "x" / "3454-pipeData.csv")
    assert arc.archive_csv(a, source_folder="f1", root=str(root)) == "stored"
    assert arc.archive_csv(a, source_folder="f1", root=str(root)) == "seen"
    assert len(_manifest(root)) == 1


def test_same_name_different_content_keeps_both(dirs):
    uc, root = dirs
    a = _write(uc / "f1" / "3454-equpData.csv", "name,pos\nA,1\n")
    b = _write(uc / "f2" / "3454-equpData.csv", "name,pos\nB,2\n")
    arc.archive_csv(a, source_folder="f1", root=str(root))
    assert arc.archive_csv(b, source_folder="f2", root=str(root)) == "stored"
    assert len(list((root / "3454").glob("*.csv"))) == 2


def test_no_hull_goes_to_unknown_and_drm_is_skipped(dirs):
    uc, root = dirs
    a = _write(uc / "f1" / "struData.csv")
    d = _write(uc / "f1" / "3454-struData.csv", raw=b"HHIDRMC" + b"\x00" * 50)
    assert arc.archive_csv(a, source_folder="f1", root=str(root)) == "stored"
    assert (root / arc.UNKNOWN_HULL / "struData.csv").is_file()
    assert arc.archive_csv(d, source_folder="f1", root=str(root)) == "drm"
    assert not (root / "3454").exists()


def test_locked_manifest_leaves_no_unrecorded_copy(dirs, monkeypatch):
    uc, root = dirs
    a = _write(uc / "f1" / "3454-struData.csv")

    def locked(*_a, **_k):
        raise PermissionError("manifest 잠김")
    monkeypatch.setattr(arc, "_append_manifest", locked)
    with pytest.raises(PermissionError):
        arc.archive_csv(a, source_folder="f1", root=str(root))
    assert not list(root.rglob("*.csv"))

    monkeypatch.undo()
    assert arc.archive_csv(a, source_folder="f1", root=str(root)) == "stored"
    assert [p.name for p in (root / "3454").glob("*.csv")] == ["3454-struData.csv"]


def test_collect_existing_only_mb_folders_top_level(dirs):
    uc, root = dirs
    _write(uc / "20261027_103007_A476854_HiTessModelBuilder" / "3592-stru.csv", "a\n")
    _write(uc / "20261027_103007_A476854_HiTessModelBuilder" / "20261027_103010" / "diag.csv", "b\n")
    _write(uc / "20261027_103007_A476854_AmToModelBuilder" / "3592-pipe.csv", "c\n")
    _write(uc / "20261027_103007_A476854_TrussAnalysis" / "node.csv", "d\n")

    assert arc.collect_existing(str(uc), root=str(root), dry_run=True) == {"found": 2}
    counts = arc.collect_existing(str(uc), root=str(root))
    assert counts == {"stored": 2}
    rows = _manifest(root)
    assert {r["employee_id"] for r in rows} == {"A476854"}
    assert rows[0]["run_at"] == "2026-10-27 10:30:07"
    assert arc.collect_existing(str(uc), root=str(root)) == {"seen": 2}


def test_run_inputs_respects_switch_and_swallows_errors(dirs, monkeypatch):
    uc, root = dirs
    work = uc / "20261027_103007_A476854_HiTessModelBuilder"
    a = _write(work / "3592-stru.csv")
    monkeypatch.setenv("MB_CSV_ARCHIVE_DIR", str(root))

    monkeypatch.setenv("MB_CSV_ARCHIVE", "0")
    assert arc.archive_run_inputs({"stru": a}, str(work)) == {}

    monkeypatch.setenv("MB_CSV_ARCHIVE", "1")
    assert arc.archive_run_inputs({"stru": a, "pipe": None}, str(work), "A476854") == {"stru": "stored"}

    def boom(*_a, **_k):
        raise OSError("disk full")
    monkeypatch.setattr(arc, "archive_csv", boom)
    assert arc.archive_run_inputs({"stru": a}, str(work)) == {"stru": "error"}
