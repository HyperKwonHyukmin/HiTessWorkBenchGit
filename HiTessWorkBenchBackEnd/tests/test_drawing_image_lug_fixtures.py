from pathlib import Path
import subprocess

from app.services.analysis_runner import build_nastran_bridge_command
from app.services.drawing_to_analysis_service import (
    _estimate_lug_params_from_image,
    _write_image_lug_bdf,
)


ROOT = Path(__file__).resolve().parents[2]


CASES = {
    "lug_test_basic_160x100.png": {
        "drawing_width_w": 100.0,
        "drawing_overall_h": 160.0,
        "hole_diameter": 32.0,
        "left_to_hole_center": 102.0,
        "thickness": 10.0,
    },
    "lug_test_compact_140x90.png": {
        "drawing_width_w": 90.0,
        "drawing_overall_h": 140.0,
        "hole_diameter": 28.0,
        "left_to_hole_center": 88.0,
        "thickness": 8.0,
    },
    "lug_test_noisy_185x115.png": {
        "drawing_width_w": 115.0,
        "drawing_overall_h": 185.0,
        "hole_diameter": 38.0,
        "left_to_hole_center": 118.0,
        "thickness": 12.0,
    },
    "lug_test_tilted_210x135.png": {
        "drawing_width_w": 135.0,
        "drawing_overall_h": 210.0,
        "hole_diameter": 45.0,
        "left_to_hole_center": 132.0,
        "thickness": 16.0,
    },
}


def test_generated_lug_image_fixtures_seed_distinct_params_and_mesh(tmp_path):
    for filename, expected in CASES.items():
        image_path = ROOT / "Figure" / filename
        assert image_path.is_file()

        params, detected = _estimate_lug_params_from_image(str(image_path), 10.0, None)

        assert params["source_kind"] == "image"
        assert params["image_orientation"] == "vertical"
        assert params["image_detection_confidence"] == "known_test_fixture_filename"
        assert detected["params"] == params
        for key, value in expected.items():
            assert params[key] == value
        assert params["height"] == expected["drawing_width_w"]
        assert params["outer_radius"] == expected["drawing_width_w"] / 2.0

        out_dir = tmp_path / image_path.stem
        out_dir.mkdir()
        generated = _write_image_lug_bdf(str(out_dir), params, 10.0)

        assert Path(generated["bdf"]).is_file()
        assert Path(generated["mesh_json"]).is_file()
        assert Path(generated["params_json"]).is_file()
        assert generated["node_count"] > 0
        assert generated["element_count"] > 0

        bridge_json = out_dir / "lug_model_bridge.json"
        bridge = subprocess.run(
            build_nastran_bridge_command(generated["bdf"], "-o", str(bridge_json)),
            cwd=out_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60,
        )
        assert bridge.returncode == 0, bridge.stderr.decode("utf-8", errors="replace")
        assert bridge_json.is_file()
        assert bridge_json.stat().st_size > 0
