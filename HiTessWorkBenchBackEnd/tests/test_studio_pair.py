"""짝 Studio 싱크 검사(scripts/studio_pair.py) — 같아야 하는 파일의 어긋남과, 지켜보는 짝의 한쪽 변경을 잡는지."""
import importlib.util
import json
import os

import pytest

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPT = os.path.join(REPO, "scripts", "studio_pair.py")
REAL_MANIFEST = os.path.join(REPO, "scripts", "studio_pair.json")


def _load():
    spec = importlib.util.spec_from_file_location("studio_pair_under_test", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def pair(tmp_path, monkeypatch):
    """Studio 두 개(a, b) + 소스 없는 c 를 가진 임시 작업장."""
    mod = _load()
    base = tmp_path / "sub"
    manifest_path = tmp_path / "studio_pair.json"
    lock_path = tmp_path / "studio_pair.lock.json"
    monkeypatch.setenv("HITESS_SUBMODULE_ROOT", str(base))
    monkeypatch.setattr(mod, "MANIFEST", str(manifest_path))
    monkeypatch.setattr(mod, "LOCK", str(lock_path))

    class Bench:
        module = mod

        def write(self, studio, rel, text):
            p = base / studio / "src" / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(text.encode("utf-8"))

        def manifest(self, group, studios=("a", "b")):
            doc = {
                "studios": {s: {"label": s.upper(), "name": f"Studio {s.upper()}", "src": f"{s}/src"} for s in studios},
                "groups": [{"id": "g", "members": ["a", "b"], **group}],
            }
            manifest_path.write_text(json.dumps(doc), encoding="utf-8")

        def run(self, *argv):
            return mod.main(list(argv))

        def lock(self):
            return json.loads(lock_path.read_text(encoding="utf-8"))["watch"]

    return Bench()


def test_same_ignores_line_endings(pair, capsys):
    pair.write("a", "data/find.js", "one\ntwo\n")
    pair.write("b", "data/find.js", "one\r\ntwo\r\n")
    pair.manifest({"same": ["data/find.js"]})
    assert pair.run() == 0
    assert "SAME_MISMATCH=0" in capsys.readouterr().out


def test_same_mismatch_fails_and_names_the_file(pair, capsys):
    pair.write("a", "data/find.js", "one\n")
    pair.write("b", "data/find.js", "one\nextra\n")
    pair.manifest({"same": ["data/find.js"]})
    assert pair.run() == 1
    out = capsys.readouterr().out
    assert "어긋남 data/find.js" in out
    assert "SAME_MISMATCH=1" in out


def test_same_file_missing_on_one_side_fails(pair, capsys):
    pair.write("a", "data/find.js", "one\n")
    pair.write("b", "data/other.js", "x\n")
    pair.manifest({"same": ["data/find.js"]})
    assert pair.run() == 1
    assert "없음   data/find.js" in capsys.readouterr().out


def test_watch_reports_only_the_side_that_changed(pair, capsys):
    pair.write("a", "shell/Tab.jsx", "a1\n")
    pair.write("b", "shell/Tab.jsx", "b1\n")
    pair.manifest({"watch": "auto"})

    assert pair.run() == 0
    assert "아직 안 살펴봄 1" in capsys.readouterr().out

    assert pair.run("--ack", "--all") == 0
    capsys.readouterr()
    assert pair.run() == 0
    assert "변동 없음 1 · 바뀜 0" in capsys.readouterr().out

    pair.write("a", "shell/Tab.jsx", "a2\n")
    assert pair.run() == 0  # 지켜보는 짝은 종료 코드를 바꾸지 않는다
    out = capsys.readouterr().out
    assert "A 쪽이 바뀜 → B 에 들여올지 검토" in out
    assert "WATCH_CHANGED=1" in out

    assert pair.run("--ack", "shell/Tab.jsx") == 0
    capsys.readouterr()
    pair.run()
    assert "WATCH_CHANGED=0" in capsys.readouterr().out


def test_watch_auto_skips_same_and_ignored_files(pair):
    for rel in ("data/find.js", "data/help.js", "shell/Tab.jsx", "assets/logo.png"):
        pair.write("a", rel, "x\n")
        pair.write("b", rel, "x\n")
    pair.write("a", "only/a.js", "x\n")
    pair.manifest({"same": ["data/find.js"], "watch": "auto", "ignore": {"data/help.js": "내용이 다름"}})
    pair.run("--ack", "--all")
    assert list(pair.lock()["g"]) == ["shell/Tab.jsx"]


def test_paths_entry_pairs_files_at_different_locations(pair, capsys):
    pair.write("a", "components/panels/Auto.jsx", "x\n")
    pair.write("b", "components/Auto.jsx", "y\n")
    pair.manifest({"same": [{"paths": {"a": "components/panels/Auto.jsx", "b": "components/Auto.jsx"}}]})
    assert pair.run() == 1
    assert "어긋남 components/panels/Auto.jsx" in capsys.readouterr().out


def test_also_adds_a_third_studio_and_absent_studio_is_skipped(pair, capsys):
    pair.write("a", "data/find.js", "x\n")
    pair.write("b", "data/find.js", "x\n")
    pair.manifest({"same": [{"path": "data/find.js", "also": ["c"]}]}, studios=("a", "b", "c"))
    assert pair.run() == 0  # c 의 소스가 이 PC 에 없으면 그 Studio 만 빼고 본다
    assert "c 는 이 PC 에 없어 비교하지 않음" in capsys.readouterr().out

    pair.write("c", "data/find.js", "different\n")
    assert pair.run() == 1
    assert "A↔C" in capsys.readouterr().out


def test_group_is_skipped_when_a_member_has_no_source(pair, capsys):
    pair.write("a", "data/find.js", "x\n")
    pair.manifest({"same": ["data/find.js"]})
    assert pair.run() == 0
    assert "건너뜀: 이 PC 에 소스가 없음" in capsys.readouterr().out


def test_repo_manifest_is_well_formed():
    mod = _load()
    with open(REAL_MANIFEST, encoding="utf-8") as f:
        doc = json.load(f)
    assert doc["groups"], "묶음이 하나도 없다"
    for group in doc["groups"]:
        assert len(group["members"]) >= 2
        seen = set()
        entries = list(group.get("same", [])) + list(group.get("watch_also", []))
        if group.get("watch") != "auto":
            entries += list(group.get("watch", []))
        for entry in entries:
            paths = mod.normalize_entry(entry, group["members"])
            assert len(paths) >= 2, f"짝이 아닌 줄: {entry}"
            for studio in paths:
                assert studio in doc["studios"], f"studios 에 없는 id: {studio}"
            key = mod.entry_key(paths)
            assert key not in seen, f"두 번 적힌 경로: {key}"
            assert key not in group.get("ignore", {}), f"ignore 와 겹침: {key}"
            seen.add(key)
