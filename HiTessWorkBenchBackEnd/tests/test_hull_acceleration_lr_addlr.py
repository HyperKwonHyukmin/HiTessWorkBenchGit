import math
import sys
from pathlib import Path


TS_DIR = Path(__file__).resolve().parents[1] / "InHouseProgram" / "TS"
if str(TS_DIR) not in sys.path:
    sys.path.insert(0, str(TS_DIR))

from ts_models import LoadingCondition, ShipConstants  # noqa: E402
from ts_rules.lr import compute  # noqa: E402


def test_lr_uses_general_gm_row_for_addlr_g28():
    constants = ShipConstants()
    condition = LoadingCondition(
        condition_no=4,
        loading_type=0,
        displacement=78294.8,
        draft_equiv=8.36,
        draft_fp=7.84,
        draft_mean=8.34,
        draft_ap=8.84,
        trim=-1.0,
        kmt=24.79,
        kg=11.27,
        ggo=2.04,
        gom=11.48,
        lcb=-5.09,
        mtc=1728.71,
        lcg=-5.112079499532536,
        roll_gyration=0.0,
        gm=13.52,
        cb=0.7062725795949233,
    )

    result = compute(constants, [condition])

    assert math.isclose(result.x.max, 0.8985018281570468, rel_tol=0, abs_tol=1e-12)
    assert math.isclose(result.y.max, 7.4715499386899324, rel_tol=0, abs_tol=1e-12)
    assert math.isclose(result.z.max, 2.105812844531739, rel_tol=0, abs_tol=1e-12)
