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


def test_scan_finds_lifting_when_stem_differs():
    # 업로드/변환으로 파일 stem 이 parent BDF stem 과 달라도,
    # 폴더에 _lifting.bdf 가 있으면 접미사 글롭으로 찾아야 한다.
    with tempfile.TemporaryDirectory() as folder:
        _touch(os.path.join(folder, "weird_name_lifting.bdf"))
        arts = scan_lifting_artifacts(folder, "model")  # stem 불일치
        by_kind = {a["kind"]: a for a in arts}
        assert "liftingBdf" in by_kind, by_kind
        assert by_kind["liftingBdf"]["fileName"] == "weird_name_lifting.bdf"


def test_scan_prefers_exact_stem_match():
    # 정확 stem 파일이 있으면 그것을 우선 사용한다.
    with tempfile.TemporaryDirectory() as folder:
        _touch(os.path.join(folder, "model_lifting.bdf"))
        _touch(os.path.join(folder, "other_lifting.bdf"))
        arts = scan_lifting_artifacts(folder, "model")
        by_kind = {a["kind"]: a for a in arts}
        assert by_kind["liftingBdf"]["fileName"] == "model_lifting.bdf"


def test_scan_finds_without_stem():
    # stem 미지정이어도 폴더에 있으면 찾는다.
    with tempfile.TemporaryDirectory() as folder:
        _touch(os.path.join(folder, "anything_lifting.bdf"))
        arts = scan_lifting_artifacts(folder)
        assert {a["kind"] for a in arts} == {"liftingBdf"}


def test_scan_empty_folder():
    with tempfile.TemporaryDirectory() as folder:
        assert scan_lifting_artifacts(folder, "model") == []


if __name__ == "__main__":
    test_scan_returns_only_existing()
    test_scan_all_four()
    test_scan_finds_lifting_when_stem_differs()
    test_scan_prefers_exact_stem_match()
    test_scan_finds_without_stem()
    test_scan_empty_folder()
    print("ALL PASS")
