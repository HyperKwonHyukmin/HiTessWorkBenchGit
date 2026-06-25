"""lifting_artifacts.scan_lifting_artifacts 단위 테스트.

프로젝트에 pytest 러너 구성이 없어도 되도록 plain script 로도 실행 가능하게 작성:
  - pytest:  python -m pytest app/services/test_lifting_artifacts.py
  - script:  python app/services/test_lifting_artifacts.py   (cwd=HiTessWorkBenchBackEnd)
"""
import os
import tempfile

from app.services.lifting_artifacts import scan_lifting_artifacts


def _touch(path: str) -> None:
    with open(path, "wb") as f:
        f.write(b"x")


def test_scan_returns_only_existing():
    with tempfile.TemporaryDirectory() as folder:
        stem = "model"
        _touch(os.path.join(folder, "model_lifting.bdf"))
        _touch(os.path.join(folder, "model_lifting.f06"))
        # _edited.bdf / _lifting.op2 는 만들지 않음 → 반환에서 빠져야 함
        arts = scan_lifting_artifacts(folder, stem)
        kinds = {a["kind"] for a in arts}
        assert kinds == {"liftingBdf", "f06"}, kinds
        by_kind = {a["kind"]: a for a in arts}
        assert by_kind["liftingBdf"]["fileName"] == "model_lifting.bdf"
        assert by_kind["liftingBdf"]["sizeBytes"] == 1
        assert os.path.isabs(by_kind["liftingBdf"]["path"])
        assert by_kind["f06"]["label"] == "Nastran F06"


def test_scan_all_four():
    with tempfile.TemporaryDirectory() as folder:
        for name in ("abc_lifting.bdf", "abc_edited.bdf", "abc_lifting.f06", "abc_lifting.op2"):
            _touch(os.path.join(folder, name))
        arts = scan_lifting_artifacts(folder, "abc")
        assert {a["kind"] for a in arts} == {"liftingBdf", "editedBdf", "f06", "op2"}


def test_scan_empty_folder():
    with tempfile.TemporaryDirectory() as folder:
        assert scan_lifting_artifacts(folder, "model") == []


if __name__ == "__main__":
    test_scan_returns_only_existing()
    test_scan_all_four()
    test_scan_empty_folder()
    print("ALL PASS")
