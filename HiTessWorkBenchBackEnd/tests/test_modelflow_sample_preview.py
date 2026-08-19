"""HiTESS Model Builder 샘플 CSV 미리보기(GET /api/analysis/modelflow/sample-preview) 계약 테스트.

해석을 돌리지 않고도 사내 표준 입력 CSV 의 컬럼 구성을 확인할 수 있어야 한다.
샘플 폴더는 실제 배포본 상태에 좌우되므로, 테스트는 _BACKEND_DIR 을 tmp_path 로
갈아끼워 **탐색 규칙 자체**를 검증한다.
"""
import os

import pytest

from app.routers import analysis


def _write_sample_dir(root, files):
    """<root>/SampleFile/ModelBuilder/ 에 파일들을 만들고 폴더 경로를 돌려준다."""
    sample_dir = os.path.join(root, "SampleFile", "ModelBuilder")
    os.makedirs(sample_dir, exist_ok=True)
    for name, text in files.items():
        with open(os.path.join(sample_dir, name), "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
    return sample_dir


STRU_CSV = "name,type,pos,ori\nS1,GENSEC,X 0mm,1.000\nS2,GENSEC,X 500mm,1.000\n"
PIPE_CSV = "name,type,outDia,thick\nP1,TUBI,73,3.05\n"
EQUIP_CSV = "name,pos,cog,mass\nE1,X 0mm,X 0mm,0\n"


@pytest.fixture()
def sample_backend_dir(tmp_path, monkeypatch):
    """_BACKEND_DIR 을 tmp_path 로 교체 — 실제 배포 샘플 폴더에 의존하지 않게 한다."""
    monkeypatch.setattr(analysis, "_BACKEND_DIR", str(tmp_path))
    return tmp_path


def test_preview_returns_all_three_csv_kinds(admin_client, sample_backend_dir):
    _write_sample_dir(sample_backend_dir, {
        "3454-struData-A505080.csv": STRU_CSV,
        "3454-pipeData-A505080.csv": PIPE_CSV,
        "3454-equpData-A505080.csv": EQUIP_CSV,
    })

    res = admin_client.get("/api/analysis/modelflow/sample-preview")

    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"stru", "pipe", "equip"}

    stru = body["stru"]
    assert stru["filename"] == "3454-struData-A505080.csv"
    assert stru["rows"][0] == ["name", "type", "pos", "ori"]
    assert stru["totalRows"] == 3          # 헤더 1 + 데이터 2
    assert stru["truncated"] is False
    assert body["pipe"]["rows"][0] == ["name", "type", "outDia", "thick"]
    assert body["equip"]["totalRows"] == 2


def test_preview_reports_missing_kind_as_null(admin_client, sample_backend_dir):
    """equip 샘플이 없어도 나머지는 정상 서빙되어야 한다(선택 입력이므로)."""
    _write_sample_dir(sample_backend_dir, {
        "3454-struData-A505080.csv": STRU_CSV,
        "3454-pipeData-A505080.csv": PIPE_CSV,
    })

    body = admin_client.get("/api/analysis/modelflow/sample-preview").json()

    assert body["equip"] is None
    assert body["stru"] is not None
    assert body["pipe"] is not None


def test_preview_404_when_sample_folder_absent(admin_client, sample_backend_dir):
    res = admin_client.get("/api/analysis/modelflow/sample-preview")
    assert res.status_code == 404


def test_preview_404_when_folder_has_no_csv(admin_client, sample_backend_dir):
    _write_sample_dir(sample_backend_dir, {"readme.txt": "not a csv"})

    res = admin_client.get("/api/analysis/modelflow/sample-preview")

    assert res.status_code == 404


def test_preview_truncates_oversized_csv(admin_client, sample_backend_dir, monkeypatch):
    """안전밸브: 상한을 넘으면 잘라내고 truncated=True + totalRows 는 원본 행 수."""
    monkeypatch.setattr(analysis, "MODELFLOW_SAMPLE_PREVIEW_MAX_ROWS", 10)
    big = "name,type\n" + "".join(f"S{i},GENSEC\n" for i in range(50))
    _write_sample_dir(sample_backend_dir, {"big-struData.csv": big})

    stru = admin_client.get("/api/analysis/modelflow/sample-preview").json()["stru"]

    assert stru["truncated"] is True
    assert len(stru["rows"]) == 10
    assert stru["totalRows"] == 51


def test_preview_reads_cp949_encoded_csv(admin_client, sample_backend_dir):
    """사내 CSV 는 cp949 로 저장돼 오는 경우가 있다 — 폴백 디코딩이 동작해야 한다."""
    sample_dir = os.path.join(sample_backend_dir, "SampleFile", "ModelBuilder")
    os.makedirs(sample_dir, exist_ok=True)
    with open(os.path.join(sample_dir, "struData-한글.csv"), "w", encoding="cp949", newline="") as fh:
        fh.write("이름,종류\n기둥,GENSEC\n")

    stru = admin_client.get("/api/analysis/modelflow/sample-preview").json()["stru"]

    assert stru["rows"] == [["이름", "종류"], ["기둥", "GENSEC"]]


def test_run_sample_and_preview_pick_the_same_files(sample_backend_dir):
    """run-sample 과 preview 가 같은 헬퍼를 쓰므로 파일 선택이 절대 어긋나지 않는다."""
    _write_sample_dir(sample_backend_dir, {
        "3454-struData-A505080.csv": STRU_CSV,
        "3454-pipeData-A505080.csv": PIPE_CSV,
        "3454-equpData-A505080.csv": EQUIP_CSV,
    })

    stru, pipe, equip = analysis._find_modelflow_sample_csvs()

    assert os.path.basename(stru) == "3454-struData-A505080.csv"
    assert os.path.basename(pipe) == "3454-pipeData-A505080.csv"
    assert os.path.basename(equip) == "3454-equpData-A505080.csv"
