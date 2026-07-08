import sys
from pathlib import Path


TS_DIR = Path(__file__).resolve().parents[1] / "InHouseProgram" / "TS"
if str(TS_DIR) not in sys.path:
    sys.path.insert(0, str(TS_DIR))

from ts_hull_acceleration import _apply_rule_length_override  # noqa: E402


def test_manual_rule_length_overrides_pdf_lbp_after_merge():
    payload = {
        "rule_length_mode": "manual",
        "manual_rule_length": 275.5,
        "lbp": 281.3,
        "length": 281.3,
    }

    result = _apply_rule_length_override(payload)

    assert result["length"] == 275.5


def test_manual_mode_falls_back_to_user_length_when_manual_rule_length_missing():
    user_constants = {
        "rule_length_mode": "manual",
        "length": 300.0,
        "lbp": 320.0,
    }
    merged_payload = {
        **user_constants,
        "length": 320.0,
        "lbp": 320.0,
    }

    result = _apply_rule_length_override(merged_payload, user_constants)

    assert result["length"] == 300.0


def test_lbp_rule_length_mode_uses_lbp_as_length():
    payload = {
        "rule_length_mode": "lbp",
        "manual_rule_length": 275.5,
        "lbp": 281.3,
        "length": 275.5,
    }

    result = _apply_rule_length_override(payload)

    assert result["length"] == 281.3
