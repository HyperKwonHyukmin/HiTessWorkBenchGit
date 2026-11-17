"""이중관 1단계 '샘플 CSV로 바로 시험' — GET /api/doublepipe/sample-csv."""
import os

from fastapi.testclient import TestClient

from app.main import app
from app.routers import doublepipe


def test_sample_csv_is_served(admin_client, tmp_path, monkeypatch):
    sample = tmp_path / "H0000_pipeData.csv"
    sample.write_bytes(b"name,type,pos\n1,TUBI,X 0mm Y 0mm Z 0mm\n")
    monkeypatch.setattr(doublepipe, "_SAMPLE_DIR", str(tmp_path))

    res = admin_client.get("/api/doublepipe/sample-csv")

    assert res.status_code == 200
    assert res.content == sample.read_bytes()
    assert "H0000_pipeData.csv" in res.headers["content-disposition"]


def test_sample_csv_missing_is_404(admin_client, tmp_path, monkeypatch):
    monkeypatch.setattr(doublepipe, "_SAMPLE_DIR", str(tmp_path / "none"))

    res = admin_client.get("/api/doublepipe/sample-csv")

    assert res.status_code == 404


def test_sample_csv_requires_login():
    app.dependency_overrides.clear()
    assert TestClient(app).get("/api/doublepipe/sample-csv").status_code == 401


def test_repo_sample_exists():
    # 저장소에 둔 실제 샘플(H3445) — 루트 .gitignore 의 *.csv 때문에 git add -f 로 넣어야 한다.
    path = doublepipe._find_sample_csv()
    assert path is not None
    assert os.path.basename(path).lower().endswith(".csv")
