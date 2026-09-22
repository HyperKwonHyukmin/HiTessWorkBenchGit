"""사용자 환경설정 서비스 계약(스펙 §4.2).

정규화 함수 4종 + `merge_prefs`(부분 병합, 화이트리스트) + `effective_prefs`(기본값 채움) +
`get_prefs`/`upsert_prefs`(SQLAlchemy 세션 호출). 값 형식 오류는 ValueError, 화이트리스트 밖
키는 조용히 무시(라우터가 `ignored_keys` 로 응답).
"""
import pytest

from app import models
from app.services.user_preferences_service import (
    LANDING_MENU_MAX_LEN,
    MAX_FAVORITES,
    MAX_RECENT_APPS,
    NOTIFICATION_KINDS_FALLBACK,
    PREFERENCE_KEYS,
    default_prefs,
    effective_prefs,
    get_prefs,
    merge_prefs,
    normalize_favorites,
    normalize_landing_menu,
    normalize_notifications,
    normalize_recent_apps,
    upsert_prefs,
)


def test_preference_keys_are_the_four_whitelisted():
    assert PREFERENCE_KEYS == ("favorites", "recent_apps", "notifications", "landing_menu")


def test_default_prefs_shape():
    d = default_prefs()
    assert d == {
        "favorites": [],
        "recent_apps": [],
        "notifications": {"muted_kinds": [], "desktop_toast": True},
        "landing_menu": None,
    }
    # 반환값은 새 dict 여야 한다(호출자가 mutate 해도 원본 오염 없어야 함).
    d["favorites"].append("x")
    assert default_prefs()["favorites"] == []


def test_normalize_favorites_trims_dedupes_and_caps():
    got = normalize_favorites(["  A  ", "B", "A", "", None, "C", "B"])
    assert got == ["A", "B", "C"]
    assert normalize_favorites(list(f"F{i}" for i in range(MAX_FAVORITES + 5))) \
        == [f"F{i}" for i in range(MAX_FAVORITES)]


def test_normalize_favorites_rejects_non_list():
    with pytest.raises(ValueError):
        normalize_favorites("A,B")


def test_normalize_recent_apps_sorts_desc_and_dedupes_by_menu():
    raw = [
        {"menu": "BDF Scanner", "label": "BDF Scanner", "at": 100},
        {"menu": "Truss Analysis", "label": "Truss Analysis", "at": 300},
        {"menu": "BDF Scanner", "label": "BDF Scanner", "at": 500},  # 같은 menu, 큰 at → 이걸 남긴다
        {"menu": "Mast Post Assessment"},  # at 없음 → 0
    ]
    got = normalize_recent_apps(raw)
    assert [x["menu"] for x in got] == ["BDF Scanner", "Truss Analysis", "Mast Post Assessment"]
    bdf = next(x for x in got if x["menu"] == "BDF Scanner")
    assert bdf["at"] == 500
    # label 자동 채움
    assert got[-1]["label"] == "Mast Post Assessment"


def test_normalize_recent_apps_caps_to_eight():
    raw = [{"menu": f"A{i}", "at": i} for i in range(MAX_RECENT_APPS + 5)]
    got = normalize_recent_apps(raw)
    assert len(got) == MAX_RECENT_APPS
    assert got[0]["menu"] == f"A{MAX_RECENT_APPS + 4}"  # 최신


def test_normalize_recent_apps_rejects_non_list():
    with pytest.raises(ValueError):
        normalize_recent_apps({"BDF Scanner": 1})


def test_normalize_recent_apps_skips_bad_rows():
    raw = [{"label": "no-menu"}, {"menu": "  ", "at": 1}, {"menu": "OK", "at": "abc"}]
    got = normalize_recent_apps(raw)
    assert [x["menu"] for x in got] == ["OK"]
    assert got[0]["at"] == 0  # 잘못된 at 은 0


def test_normalize_notifications_partial_merge_keeps_other_keys():
    old = {"muted_kinds": ["notice.published"], "desktop_toast": False}
    got = normalize_notifications({"desktop_toast": True}, previous=old)
    assert got == {"muted_kinds": ["notice.published"], "desktop_toast": True}


def test_normalize_notifications_rejects_unknown_kind_and_bad_types():
    with pytest.raises(ValueError):
        normalize_notifications({"muted_kinds": ["job.done"]})
    with pytest.raises(ValueError):
        normalize_notifications({"desktop_toast": "yes"})
    with pytest.raises(ValueError):
        normalize_notifications({"muted_kinds": "job.completed"})


def test_normalize_notifications_dedupes_and_sorts():
    got = normalize_notifications({"muted_kinds": ["job.failed", "job.completed", "job.failed"]})
    assert got["muted_kinds"] == ["job.completed", "job.failed"]


def test_normalize_notifications_accepts_all_known_kinds():
    for k in NOTIFICATION_KINDS_FALLBACK:
        got = normalize_notifications({"muted_kinds": [k]})
        assert got["muted_kinds"] == [k]


def test_normalize_landing_menu_trims_and_nullifies_blank():
    assert normalize_landing_menu("  My Projects ") == "My Projects"
    assert normalize_landing_menu("") is None
    assert normalize_landing_menu(None) is None


def test_normalize_landing_menu_length_cap():
    ok = "M" * LANDING_MENU_MAX_LEN
    assert normalize_landing_menu(ok) == ok
    with pytest.raises(ValueError):
        normalize_landing_menu("M" * (LANDING_MENU_MAX_LEN + 1))


def test_merge_prefs_only_applies_whitelisted_keys_and_returns_ignored():
    current = {"favorites": ["Truss Analysis"], "landing_menu": "Dashboard"}
    payload = {
        "favorites": ["BDF Scanner"],
        "unknown_key": "ignored",
        "notifications": {"desktop_toast": False},
        "recent_apps": [{"menu": "BDF Scanner", "at": 10}],
        "landing_menu": " My Projects ",
    }
    merged, ignored = merge_prefs(current, payload)
    assert ignored == ["unknown_key"]
    assert merged["favorites"] == ["BDF Scanner"]
    assert merged["landing_menu"] == "My Projects"
    assert merged["notifications"]["desktop_toast"] is False
    # 부분 병합: muted_kinds 는 current 에 없었으므로 기본값이 채워진다.
    assert merged["notifications"]["muted_kinds"] == []
    # recent_apps 는 배열로 저장.
    assert merged["recent_apps"] == [{"menu": "BDF Scanner", "label": "BDF Scanner",
                                      "mode": "", "category": "", "at": 10}]


def test_merge_prefs_raises_on_bad_value():
    with pytest.raises(ValueError):
        merge_prefs({}, {"favorites": "not a list"})


def test_effective_prefs_fills_missing_keys():
    stored = {"favorites": ["X"]}
    got = effective_prefs(stored)
    assert got == {
        "favorites": ["X"],
        "recent_apps": [],
        "notifications": {"muted_kinds": [], "desktop_toast": True},
        "landing_menu": None,
    }


def test_get_prefs_returns_default_when_no_row(db_session):
    got = get_prefs(db_session, "NOBODY")
    assert got == (default_prefs(), None)
    # 조회만으로 행을 만들지 않는다 — 사이드 이펙트 없어야 GET 이 idempotent.
    assert db_session.query(models.UserPreference).count() == 0


def test_upsert_prefs_creates_row_and_returns_merged(db_session):
    merged, ignored = upsert_prefs(db_session, "EMP001", {"favorites": ["BDF Scanner"]})
    assert ignored == []
    row = db_session.query(models.UserPreference).one()
    assert row.prefs["favorites"] == ["BDF Scanner"]
    assert row.updated_at is not None
    assert merged == effective_prefs(row.prefs)


def test_upsert_prefs_partial_update_preserves_other_keys(db_session):
    upsert_prefs(db_session, "EMP001",
                 {"favorites": ["A"], "notifications": {"muted_kinds": ["notice.published"]}})
    upsert_prefs(db_session, "EMP001", {"landing_menu": "My Projects"})
    row = db_session.query(models.UserPreference).one()
    # 저장은 화이트리스트 키만. 이전 favorites·notifications 는 유지.
    assert row.prefs["favorites"] == ["A"]
    assert row.prefs["notifications"] == {"muted_kinds": ["notice.published"], "desktop_toast": True}
    assert row.prefs["landing_menu"] == "My Projects"


def test_upsert_prefs_reassigns_dict_so_json_column_tracks_change(db_session):
    """JSON 컬럼은 in-place mutate 를 감지하지 못한다 — 새 dict 대입 여부를 확인한다."""
    upsert_prefs(db_session, "EMP001", {"favorites": ["A"]})
    row = db_session.query(models.UserPreference).one()
    upsert_prefs(db_session, "EMP001", {"favorites": ["A", "B"]})
    db_session.refresh(row)
    # 실제 값이 반영됐는지가 본질.
    assert row.prefs["favorites"] == ["A", "B"]
    # 그리고 fresh 세션에서 다시 열어도 반영돼 있어야 한다.
    db_session.expire_all()
    row2 = db_session.query(models.UserPreference).one()
    assert row2.prefs["favorites"] == ["A", "B"]


def test_upsert_prefs_returns_ignored_keys(db_session):
    _, ignored = upsert_prefs(db_session, "EMP001",
                              {"favorites": ["A"], "unknown": 1, "another_unknown": True})
    assert set(ignored) == {"unknown", "another_unknown"}
