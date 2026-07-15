"""App별 공지·게시판 API 회귀 테스트."""

from app import models
from app.dependencies import require_admin, require_auth
from app.main import app


APP_KEY = "hitess-model-builder"


def _seed_app_space(db_session):
    db_session.add(models.AppSpace(
        app_key=APP_KEY,
        display_name="HiTESS Model Builder",
        notice_enabled=True,
        board_enabled=True,
        is_active=True,
    ))
    db_session.commit()


def test_entry_notice_is_shown_once_per_user(admin_client, db_session):
    _seed_app_space(db_session)
    notice = models.Notice(
        app_key=APP_KEY,
        type="Notice",
        title="첫 진입 공지",
        content="한 번만 표시됩니다.",
        show_on_entry=True,
        publish_status="published",
        revision=1,
        author_id="ADMIN001",
        author_name="관리자",
    )
    db_session.add(notice)
    db_session.commit()

    first = admin_client.get(f"/api/apps/{APP_KEY}/entry-notices")
    assert first.status_code == 200
    assert [item["id"] for item in first.json()] == [notice.id]

    acknowledged = admin_client.post(
        f"/api/apps/{APP_KEY}/notices/{notice.id}/acknowledge"
    )
    assert acknowledged.status_code == 200

    second = admin_client.get(f"/api/apps/{APP_KEY}/entry-notices")
    assert second.status_code == 200
    assert second.json() == []


def test_app_and_global_notices_are_not_mixed(admin_client, db_session):
    _seed_app_space(db_session)
    db_session.add_all([
        models.Notice(
            app_key=APP_KEY,
            type="Notice",
            title="App 공지",
            content="App 전용",
            publish_status="published",
            author_id="ADMIN001",
        ),
        models.Notice(
            app_key=None,
            type="Notice",
            title="전체 공지",
            content="전체 전용",
            publish_status="published",
            author_id="ADMIN001",
        ),
    ])
    db_session.commit()

    app_notices = admin_client.get(f"/api/apps/{APP_KEY}/notices")
    assert app_notices.status_code == 200
    assert [item["title"] for item in app_notices.json()] == ["App 공지"]

    global_notices = admin_client.get("/api/notices")
    assert global_notices.status_code == 200
    assert [item["title"] for item in global_notices.json()] == ["전체 공지"]


def test_request_author_comes_from_authenticated_user(admin_client, db_session):
    _seed_app_space(db_session)
    response = admin_client.post("/api/feature-requests", json={
        "app_key": APP_KEY,
        "title": "작성자 위조 방지",
        "content": "요청 내용",
        "author_id": "SPOOFED",
        "author_name": "위조 사용자",
    })

    assert response.status_code == 200
    assert response.json()["author_id"] == "ADMIN001"
    assert response.json()["author_name"] == "관리자"


def test_regular_user_can_create_board_post(admin_client, db_session):
    _seed_app_space(db_session)
    db_session.add(models.User(
        employee_id="USER001",
        name="일반 사용자",
        company="HHI",
        is_active=True,
        is_admin=False,
    ))
    db_session.commit()
    app.dependency_overrides[require_auth] = lambda: "USER001"

    response = admin_client.post("/api/feature-requests", json={
        "app_key": APP_KEY,
        "title": "일반 사용자 게시글",
        "content": "모든 사용자가 등록할 수 있습니다.",
        "author_id": "USER001",
        "author_name": "일반 사용자",
    })

    assert response.status_code == 200
    assert response.json()["author_id"] == "USER001"


def test_regular_user_cannot_create_notice(admin_client, db_session):
    _seed_app_space(db_session)
    db_session.add(models.User(
        employee_id="USER001",
        name="일반 사용자",
        company="HHI",
        is_active=True,
        is_admin=False,
    ))
    db_session.commit()
    app.dependency_overrides[require_auth] = lambda: "USER001"
    app.dependency_overrides.pop(require_admin, None)

    response = admin_client.post("/api/notices", json={
        "app_key": APP_KEY,
        "type": "Notice",
        "title": "권한 없는 공지",
        "content": "등록되면 안 됩니다.",
        "author_id": "USER001",
        "author_name": "일반 사용자",
    })

    assert response.status_code == 403


def test_unregistered_app_returns_404(admin_client):
    response = admin_client.get("/api/apps/not-registered/community")
    assert response.status_code == 404


def test_editing_notice_reshows_after_acknowledge(admin_client, db_session):
    """공지를 수정하면 revision이 올라가 이미 확인한 사용자에게도 다시 노출된다."""
    _seed_app_space(db_session)
    notice = models.Notice(
        app_key=APP_KEY,
        type="Notice",
        title="원본 제목",
        content="원본 내용",
        show_on_entry=True,
        publish_status="published",
        revision=1,
        author_id="ADMIN001",
        author_name="관리자",
    )
    db_session.add(notice)
    db_session.commit()
    notice_id = notice.id

    admin_client.post(f"/api/apps/{APP_KEY}/notices/{notice_id}/acknowledge")
    assert admin_client.get(f"/api/apps/{APP_KEY}/entry-notices").json() == []

    updated = admin_client.put(f"/api/notices/{notice_id}", json={
        "app_key": APP_KEY,
        "type": "Notice",
        "title": "수정된 제목",
        "content": "수정된 내용",
        "show_on_entry": True,
        "author_id": "ADMIN001",
    })
    assert updated.status_code == 200
    assert updated.json()["revision"] == 2

    reshown = admin_client.get(f"/api/apps/{APP_KEY}/entry-notices").json()
    assert [item["id"] for item in reshown] == [notice_id]


def test_upvote_is_deduplicated_per_user(admin_client, db_session):
    """같은 사용자가 반복 추천해도 카운트는 한 번만 증가하고, 목록에 반영된다."""
    _seed_app_space(db_session)
    req = models.FeatureRequest(
        app_key=APP_KEY,
        title="추천 대상 글",
        content="내용",
        author_id="USER001",
        author_name="작성자",
    )
    db_session.add(req)
    db_session.commit()
    req_id = req.id

    first = admin_client.put(f"/api/feature-requests/{req_id}/upvote")
    assert first.status_code == 200
    assert first.json()["upvotes"] == 1

    second = admin_client.put(f"/api/feature-requests/{req_id}/upvote")
    assert second.status_code == 200
    assert second.json()["upvotes"] == 1

    listing = admin_client.get(f"/api/apps/{APP_KEY}/feature-requests").json()
    assert listing[0]["upvoted_by_me"] is True


def test_author_can_edit_and_delete_own_post(admin_client, db_session):
    _seed_app_space(db_session)
    db_session.add(models.User(
        employee_id="USER001", name="일반 사용자", company="HHI",
        is_active=True, is_admin=False,
    ))
    req = models.FeatureRequest(
        app_key=APP_KEY, title="원본 글", content="원본 내용",
        author_id="USER001", author_name="일반 사용자",
    )
    db_session.add(req)
    db_session.commit()
    req_id = req.id

    app.dependency_overrides[require_auth] = lambda: "USER001"

    edited = admin_client.put(f"/api/feature-requests/{req_id}", json={
        "title": "수정된 글", "content": "수정된 내용",
    })
    assert edited.status_code == 200
    assert edited.json()["title"] == "수정된 글"

    deleted = admin_client.delete(f"/api/feature-requests/{req_id}")
    assert deleted.status_code == 200


def test_non_author_cannot_edit_or_delete_others_post(admin_client, db_session):
    _seed_app_space(db_session)
    db_session.add_all([
        models.User(employee_id="USER001", name="작성자", company="HHI",
                    is_active=True, is_admin=False),
        models.User(employee_id="USER002", name="타인", company="HHI",
                    is_active=True, is_admin=False),
    ])
    req = models.FeatureRequest(
        app_key=APP_KEY, title="남의 글", content="내용",
        author_id="USER001", author_name="작성자",
    )
    db_session.add(req)
    db_session.commit()
    req_id = req.id

    app.dependency_overrides[require_auth] = lambda: "USER002"

    edit = admin_client.put(f"/api/feature-requests/{req_id}", json={
        "title": "가로채기", "content": "침해",
    })
    assert edit.status_code == 403

    delete = admin_client.delete(f"/api/feature-requests/{req_id}")
    assert delete.status_code == 403
