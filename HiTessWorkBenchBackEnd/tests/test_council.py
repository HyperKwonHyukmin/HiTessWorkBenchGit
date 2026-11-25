"""구조해석 자동화 협의체 과제 현황 API(routers/council.py)와 /council/ 페이지 경로."""
from fastapi.testclient import TestClient

from app import models
from app.main import app
from app.routers import admin_web


def _make_task(client, **over):
    body = {"title": "권상 시뮬레이션 속도 개선", "department": "선장설계"}
    body.update(over)
    res = client.post("/api/council/tasks", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_create_list_and_update_task(admin_client):
    task = _make_task(admin_client, important=True, due_date="2026-12-15", owner="권혁민 책임")
    assert task["status"] == "reviewing" and task["important"] is True and task["notes"] == []

    board = admin_client.get("/api/council/board").json()
    assert [t["id"] for t in board["tasks"]] == [task["id"]]
    assert {s["key"] for s in board["statuses"]} == {"reviewing", "developing", "piloting", "done", "hold"}
    assert board["me"]["employee_id"] == "ADMIN001"

    res = admin_client.patch(f"/api/council/tasks/{task['id']}", json={"status": "developing", "next_step": "  시제품  "})
    assert res.status_code == 200
    updated = res.json()
    assert updated["status"] == "developing" and updated["next_step"] == "시제품"
    # 상태를 바꿔도 기록(로그)을 남기지 않는다(사용자 결정 2026-11-25)
    assert updated["notes"] == []


def test_validation(admin_client):
    assert admin_client.post("/api/council/tasks", json={"title": " ", "department": "선장설계"}).status_code == 422
    assert admin_client.post("/api/council/tasks", json={"title": "a", "department": "b", "status": "x"}).status_code == 422
    assert admin_client.post("/api/council/tasks", json={"title": "a", "department": "b", "due_date": "2026-13-01"}).status_code == 422
    task = _make_task(admin_client)
    # 목표일 지우기(빈 문자열 → 미정)
    res = admin_client.patch(f"/api/council/tasks/{task['id']}", json={"due_date": ""})
    assert res.status_code == 200 and res.json()["due_date"] is None


def test_notes_crud_and_status_note_is_locked(admin_client):
    task = _make_task(admin_client)
    res = admin_client.post(f"/api/council/tasks/{task['id']}/notes", json={"kind": "comment", "body": "우선순위를 올려 주세요."})
    assert res.status_code == 200
    note = res.json()["notes"][0]
    assert note["kind"] == "comment" and note["author_id"] == "ADMIN001"

    assert admin_client.post(f"/api/council/tasks/{task['id']}/notes", json={"kind": "status", "body": "x"}).status_code == 422

    res = admin_client.patch(f"/api/council/notes/{note['id']}", json={"body": "고친 의견"})
    assert res.status_code == 200 and res.json()["notes"][0]["body"] == "고친 의견"
    assert res.json()["notes"][0]["updated_at"] is not None

    res = admin_client.delete(f"/api/council/notes/{note['id']}")
    assert res.status_code == 200 and res.json()["notes"] == []

    assert admin_client.patch(f"/api/council/tasks/{task['id']}", json={"status": "done"}).json()["notes"] == []


def test_old_status_notes_are_hidden(admin_client, db_session):
    """옛 판이 남긴 상태 변경 기록은 화면에 내보내지 않고, 고치거나 지울 수도 없다."""
    task = _make_task(admin_client)
    old = models.CouncilNote(task_id=task["id"], kind="status", body="검토 중 → 개발 중", author_id="ADMIN001")
    db_session.add(old)
    db_session.commit()
    admin_client.post(f"/api/council/tasks/{task['id']}/notes", json={"kind": "comment", "body": "의견"})
    board = admin_client.get("/api/council/board").json()
    assert [n["kind"] for n in board["tasks"][0]["notes"]] == ["comment"]
    assert admin_client.delete(f"/api/council/notes/{old.id}").status_code == 422


def test_delete_is_soft_and_hidden(admin_client, db_session):
    task = _make_task(admin_client)
    assert admin_client.delete(f"/api/council/tasks/{task['id']}").status_code == 200
    assert admin_client.get("/api/council/board").json()["tasks"] == []
    row = db_session.query(models.CouncilTask).filter_by(id=task["id"]).first()
    assert row is not None and row.deleted_at is not None
    assert admin_client.patch(f"/api/council/tasks/{task['id']}", json={"title": "x"}).status_code == 404
    assert admin_client.post(f"/api/council/tasks/{task['id']}/notes", json={"body": "x"}).status_code == 404


def test_seed_first_meeting_only_once(admin_client):
    res = admin_client.post("/api/council/seed-first-meeting")
    assert res.status_code == 200 and res.json()["count"] == 10
    tasks = admin_client.get("/api/council/board").json()["tasks"]
    assert len(tasks) == 10
    assert {t["department"] for t in tasks} >= {"선장설계", "기장설계", "미래기술개발부"}
    # 가운뎃점을 쓰지 않는다(사용자 표기 규칙)
    assert all("\u00b7" not in (t["title"] + (t["summary"] or "")) for t in tasks)
    assert admin_client.post("/api/council/seed-first-meeting").status_code == 409
    assert admin_client.get("/api/council/board").json()["has_any"] is True


def test_has_any_counts_deleted_tasks(admin_client):
    assert admin_client.get("/api/council/board").json()["has_any"] is False
    task = _make_task(admin_client)
    admin_client.delete(f"/api/council/tasks/{task['id']}")
    board = admin_client.get("/api/council/board").json()
    assert board["tasks"] == [] and board["has_any"] is True
    assert admin_client.post("/api/council/seed-first-meeting").status_code == 409


def test_non_admin_is_blocked(switchable_client):
    client = switchable_client
    client.as_user()
    assert client.get("/api/council/board").status_code == 403
    assert client.post("/api/council/tasks", json={"title": "a", "department": "b"}).status_code == 403
    assert client.post("/api/council/seed-first-meeting").status_code == 403


def test_access_endpoint(db_session, monkeypatch):
    from app import database
    from app.routers import council

    db_session.add_all([
        models.User(employee_id="ADM", name="관리자", is_active=True, is_admin=True),
        models.User(employee_id="USR", name="사용자", is_active=True, is_admin=False),
    ])
    db_session.commit()
    tokens = {"t-adm": "ADM", "t-usr": "USR"}
    monkeypatch.setattr(council.session_store, "get_employee_id", lambda tok: tokens.get(tok))
    app.dependency_overrides[database.get_db] = lambda: db_session
    try:
        client = TestClient(app)
        assert client.get("/api/council/access").status_code == 401
        assert client.get("/api/council/access", headers={"Authorization": "Bearer t-adm"}).json()["allowed"] is True
        res = client.get("/api/council/access", headers={"Authorization": "Bearer t-usr"})
        assert res.status_code == 200 and res.json()["allowed"] is False
    finally:
        app.dependency_overrides.clear()


def test_council_page_routes(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "council.html").write_text("<html>council</html>", encoding="utf-8")
    (tmp_path / "assets" / "c.js").write_text("x", encoding="utf-8")
    monkeypatch.setattr(admin_web, "ADMIN_WEB_DIR", tmp_path)
    client = TestClient(app)
    res = client.get("/council", follow_redirects=False)
    assert res.status_code == 307 and res.headers["location"] == "/council/"
    assert "council" in client.get("/council/").text
    assert client.get("/council/assets/c.js").status_code == 200
    assert client.get("/council/..%2F..%2Fsecret.txt").status_code == 404
    assert client.get("/council//host/share/x.js").status_code == 404


# ── 항목, 마일스톤, 과제 기간(2026-11-25 Team Planner 과제 관리 기능) ─────────────────

def test_items_crud_and_order(admin_client):
    task = _make_task(admin_client)
    tid = task["id"]
    assert task["items"] == [] and task["milestones"] == []

    res = admin_client.post(f"/api/council/tasks/{tid}/items", json={"title": "시제품", "due_date": "2026-12-20", "assignee": "김한별 책임"})
    assert res.status_code == 200, res.text
    res = admin_client.post(f"/api/council/tasks/{tid}/items", json={"title": "요구 정리", "start_date": "2026-11-26", "due_date": "2026-12-05"})
    items = res.json()["items"]
    # 마감 빠른 순
    assert [i["title"] for i in items] == ["요구 정리", "시제품"]
    assert items[0]["status"] == "todo" and items[0]["done_at"] is None

    first = items[0]["id"]
    done = admin_client.patch(f"/api/council/items/{first}", json={"status": "done"}).json()
    row = next(i for i in done["items"] if i["id"] == first)
    assert row["status"] == "done" and row["done_at"] is not None
    back = admin_client.patch(f"/api/council/items/{first}", json={"status": "doing", "assignee": ""}).json()
    row = next(i for i in back["items"] if i["id"] == first)
    assert row["status"] == "doing" and row["done_at"] is None and row["assignee"] is None

    after = admin_client.delete(f"/api/council/items/{first}").json()
    assert [i["title"] for i in after["items"]] == ["시제품"]
    # 목록에도 실린다
    board = admin_client.get("/api/council/board").json()
    assert board["tasks"][0]["items"][0]["title"] == "시제품"
    assert "items" in board["features"]


def test_undo_restores_done_time(admin_client):
    """잘못 누른 상태 원을 되돌리면 완료 시각도 원래대로(보드의 '최근 2주 완료'에 다시 뜨지 않게)."""
    tid = _make_task(admin_client)["id"]
    item = admin_client.post(f"/api/council/tasks/{tid}/items", json={"title": "a", "due_date": "2026-10-01"}).json()["items"][0]
    old = "2026-10-02T09:30:00"
    done = admin_client.patch(f"/api/council/items/{item['id']}", json={"status": "done", "done_at": old}).json()["items"][0]
    assert done["done_at"] == old
    admin_client.patch(f"/api/council/items/{item['id']}", json={"status": "todo"})
    again = admin_client.patch(f"/api/council/items/{item['id']}", json={"status": "done", "done_at": "엉뚱한 값"}).json()["items"][0]
    assert again["done_at"] is not None and again["done_at"] != old          # 틀린 값은 버리고 지금 시각
    future = admin_client.patch(f"/api/council/items/{item['id']}", json={"status": "todo"}).json()
    future = admin_client.patch(f"/api/council/items/{item['id']}", json={"status": "done", "done_at": "2099-01-01T00:00:00"}).json()["items"][0]
    assert future["done_at"] < "2099"


def test_item_validation(admin_client):
    tid = _make_task(admin_client)["id"]
    post = lambda body: admin_client.post(f"/api/council/tasks/{tid}/items", json=body).status_code
    assert post({"title": "a"}) == 422                                   # 마감일 필수
    assert post({"title": " ", "due_date": "2026-12-01"}) == 422
    assert post({"title": "a", "due_date": "2026-12-01", "status": "x"}) == 422
    assert post({"title": "a", "due_date": "2026-12-01", "start_date": "2026-12-02"}) == 422
    assert post({"title": "a", "due_date": "2026-12-01", "start_date": "2026-12-01"}) == 200
    item = admin_client.get("/api/council/board").json()["tasks"][0]["items"][0]
    assert admin_client.patch(f"/api/council/items/{item['id']}", json={"due_date": ""}).status_code == 422
    assert admin_client.patch(f"/api/council/items/{item['id']}", json={"due_date": "2026-11-30"}).status_code == 422   # 시작보다 앞
    assert admin_client.patch(f"/api/council/items/{item['id']}", json={"start_date": "", "due_date": "2026-11-30"}).status_code == 200
    assert admin_client.patch("/api/council/items/99999", json={"title": "x"}).status_code == 404


def test_milestones_and_task_period(admin_client):
    task = _make_task(admin_client, start_date="2026-11-25", due_date="2026-12-31")
    assert task["start_date"] == "2026-11-25"
    tid = task["id"]
    assert admin_client.patch(f"/api/council/tasks/{tid}", json={"start_date": "2027-01-05"}).status_code == 422
    admin_client.post(f"/api/council/tasks/{tid}/milestones", json={"date": "2026-12-22", "title": "2차 회의 시연"})
    res = admin_client.post(f"/api/council/tasks/{tid}/milestones", json={"date": "2026-12-01", "title": "착수"})
    ms = res.json()["milestones"]
    assert [m["title"] for m in ms] == ["착수", "2차 회의 시연"]
    assert admin_client.post(f"/api/council/tasks/{tid}/milestones", json={"date": "x", "title": "a"}).status_code == 422
    moved = admin_client.patch(f"/api/council/milestones/{ms[0]['id']}", json={"date": "2026-12-25"}).json()
    assert [m["title"] for m in moved["milestones"]] == ["2차 회의 시연", "착수"]
    gone = admin_client.delete(f"/api/council/milestones/{ms[0]['id']}").json()
    assert [m["title"] for m in gone["milestones"]] == ["2차 회의 시연"]


def test_items_of_deleted_task_are_locked(admin_client):
    tid = _make_task(admin_client)["id"]
    item = admin_client.post(f"/api/council/tasks/{tid}/items", json={"title": "a", "due_date": "2026-12-01"}).json()["items"][0]
    admin_client.delete(f"/api/council/tasks/{tid}")
    assert admin_client.patch(f"/api/council/items/{item['id']}", json={"status": "done"}).status_code == 404
    assert admin_client.post(f"/api/council/tasks/{tid}/milestones", json={"date": "2026-12-01", "title": "a"}).status_code == 404


def test_non_admin_cannot_touch_items(switchable_client):
    client = switchable_client
    tid = client.post("/api/council/tasks", json={"title": "a", "department": "b"}).json()["id"]
    item = client.post(f"/api/council/tasks/{tid}/items", json={"title": "a", "due_date": "2026-12-01"}).json()["items"][0]
    client.as_user()
    assert client.post(f"/api/council/tasks/{tid}/items", json={"title": "a", "due_date": "2026-12-01"}).status_code == 403
    assert client.patch(f"/api/council/items/{item['id']}", json={"status": "done"}).status_code == 403
    assert client.delete(f"/api/council/items/{item['id']}").status_code == 403
    assert client.post(f"/api/council/tasks/{tid}/milestones", json={"date": "2026-12-01", "title": "a"}).status_code == 403


def test_bootstrap_adds_start_date_to_old_table():
    """145 에는 start_date 없는 council_tasks 가 먼저 만들어졌다 — 시작 때 칸이 보강돼야 한다(두 번 돌려도 그대로)."""
    from sqlalchemy import create_engine, inspect, text
    from app.schema_bootstrap import ensure_council_columns

    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE council_tasks (id INTEGER PRIMARY KEY, title VARCHAR(200), due_date VARCHAR(10))"))
    ensure_council_columns(engine=engine)
    ensure_council_columns(engine=engine)
    assert "start_date" in {c["name"] for c in inspect(engine).get_columns("council_tasks")}
