"""이중관 PSA 해석 모델(inp) 읽기 — Stress Analysis 3D '번호 찾기'용."""
import os

from app.routers import doublepipe
from app.services.doublepipe_inp_model import find_base_inp, parse_inp_model

# 엔진(ExportINP) 출력 모양을 줄인 것: 외관(_o) 은 내관(_i) 옆 Y +5 에 있다.
SAMPLE_INP = """**Pref : 15.3
*NODE
         1,   49750.0,    3855.0,   28166.0
         2,   54748.0,    3855.0,   28166.0
         3,   50612.0,    3850.0,   28166.0
         4,   53800.0,    3850.0,   28166.0
        64,   50612.0,    3855.0,   28166.0
       150,   52000.0,    3855.0,   28166.0
*ELEMENT,TYPE=B32,ELSET=Line1
        46,         1,       150,         2
*ELEMENT,TYPE=B32,ELSET=Line4
        47,         3,         4,         4
*ELEMENT,TYPE=ELBOW31B,ELSET=Elbow1
       106,         2,         1,         3
*ELEMENT,TYPE=CONN3D2,ELSET=CN1
        86,         1,        64
*NSET, NSET=FIX
1, 2
*BEAM SECTION, ELSET=Line1, MATERIAL= A312_TP316L_o, SECTION=PIPE
84.15     ,10.97
0.0       ,0.0       ,1.0
*BEAM SECTION, ELSET=Line4, MATERIAL= A312_TP316L_i, SECTION=PIPE
57.15     ,3.05
0.0       ,0.0       ,1.0
*BEAM SECTION, ELSET=Elbow1, MATERIAL= A312_TP316L_01_o, SECTION=ELBOW
84.15     ,10.97     ,152.0
"""


def test_parse_nodes_elements_and_groups():
    model = parse_inp_model(SAMPLE_INP)
    assert model["nodes"][1] == [49750.0, 3855.0, 28166.0]
    assert len(model["nodes"]) == 6           # *NSET 줄은 Node 로 읽지 않는다
    assert model["elements"][46] == {"type": "B32", "elset": "Line1", "nodes": [1, 150, 2], "group": "outer"}
    assert model["elements"][47]["group"] == "inner"
    assert model["elements"][106]["group"] == "outer"
    assert model["elements"][86]["group"] == "connector"


def test_find_base_inp_prefers_csv_stem(tmp_path):
    (tmp_path / "pipe.csv").write_text("x")
    (tmp_path / "L1_OPE_W+P1.inp").write_text("*NODE\n")
    (tmp_path / "pipe.inp").write_text("*NODE\n")
    assert os.path.basename(find_base_inp(str(tmp_path))) == "pipe.inp"


def test_route_returns_model(admin_client, tmp_path, monkeypatch):
    conn = tmp_path / "userConnection"
    job = conn / "20261117_090000_ADMIN001_DoublePipeFuelLine"
    job.mkdir(parents=True)
    (job / "pipe.csv").write_text("x")
    (job / "pipe.inp").write_text(SAMPLE_INP)
    monkeypatch.setattr(doublepipe, "_USER_CONNECTION_DIR", str(conn))

    res = admin_client.get("/api/doublepipe/psa-model", params={"path": str(job / "Report for PSA.xlsx")})

    assert res.status_code == 200
    body = res.json()
    assert body["file"] == "pipe.inp"
    assert body["elements"]["46"]["group"] == "outer"
    assert body["nodes"]["3"] == [50612.0, 3850.0, 28166.0]


def test_route_rejects_outside_path(admin_client, tmp_path, monkeypatch):
    monkeypatch.setattr(doublepipe, "_USER_CONNECTION_DIR", str(tmp_path / "userConnection"))
    res = admin_client.get("/api/doublepipe/psa-model", params={"path": str(tmp_path / "other" / "a.inp")})
    assert res.status_code == 400


def test_route_404_without_inp(admin_client, tmp_path, monkeypatch):
    conn = tmp_path / "userConnection"
    job = conn / "20261117_090000_ADMIN001_DoublePipeFuelLine"
    job.mkdir(parents=True)
    monkeypatch.setattr(doublepipe, "_USER_CONNECTION_DIR", str(conn))
    res = admin_client.get("/api/doublepipe/psa-model", params={"path": str(job / "x.xlsx")})
    assert res.status_code == 404
