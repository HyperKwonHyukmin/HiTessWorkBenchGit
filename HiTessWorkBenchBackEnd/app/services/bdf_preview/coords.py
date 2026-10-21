"""좌표계 → 전역(basic) 좌표. CORD2R/C/S 는 세 점(A 원점, B z 축 위, C xz 평면 위), CORD1R/C/S 는 세 GRID 로 정한다.

정의가 서로를 참조하므로(좌표계가 다른 좌표계·GRID 를 기준으로 함) 더 풀리는 것이 없을 때까지 반복한다.
풀린 좌표계는 systems 로 돌려받을 수 있다 — 보의 방향 벡터·오프셋(GRID 의 변위 좌표계 CD 성분)을
기본 좌표계로 돌릴 때 쓴다(04c).
"""
import math

Vec = tuple[float, float, float]


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _unit(a: Vec) -> Vec:
    n = math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2)
    if n < 1e-12:
        raise ValueError("퇴화한 좌표계")
    return (a[0] / n, a[1] / n, a[2] / n)


class CoordSystem:
    def __init__(self, kind: str, origin: Vec, ex: Vec, ey: Vec, ez: Vec):
        self.kind, self.o, self.ex, self.ey, self.ez = kind, origin, ex, ey, ez
        self.is_basic = kind == "R" and origin == (0.0, 0.0, 0.0) and ex == (1.0, 0.0, 0.0) and ey == (0.0, 1.0, 0.0)

    def to_basic(self, p) -> Vec:
        a, b, c = float(p[0]), float(p[1]), float(p[2])
        if self.kind == "C":
            t = math.radians(b)
            a, b = a * math.cos(t), a * math.sin(t)
        elif self.kind == "S":
            th, ph = math.radians(b), math.radians(c)
            a, b, c = a * math.sin(th) * math.cos(ph), a * math.sin(th) * math.sin(ph), a * math.cos(th)
        if self.is_basic:
            return (a, b, c)
        o, x, y, z = self.o, self.ex, self.ey, self.ez
        return (o[0] + a * x[0] + b * y[0] + c * z[0],
                o[1] + a * x[1] + b * y[1] + c * z[1],
                o[2] + a * x[2] + b * y[2] + c * z[2])

    def _rotate(self, a: float, b: float, c: float) -> Vec:
        """국부 직교 성분(ex·ey·ez 기준) → 기본 좌표계 성분(원점 이동 없음)."""
        x, y, z = self.ex, self.ey, self.ez
        return (a * x[0] + b * y[0] + c * z[0], a * x[1] + b * y[1] + c * z[1], a * x[2] + b * y[2] + c * z[2])

    def vector_to_basic(self, v, at: Vec) -> Vec:
        """이 좌표계 성분의 벡터 v → 기본 좌표계 벡터. 원통·구 좌표계는 점 at(기본 좌표)의 국부 기저
        (원통 = e_r·e_θ·e_z, 구 = e_r·e_θ·e_φ)를 쓴다 — Nastran 변위 좌표계(CD)의 규약.
        축 위의 점(r≈0)처럼 각이 정해지지 않으면 각 0 으로 본다."""
        a, b, c = float(v[0]), float(v[1]), float(v[2])
        if self.kind == "R":
            return (a, b, c) if self.is_basic else self._rotate(a, b, c)
        d = _sub(at, self.o)
        # at 을 이 좌표계의 국부 직교 좌표로(회전 행렬의 전치)
        lx = d[0] * self.ex[0] + d[1] * self.ex[1] + d[2] * self.ex[2]
        ly = d[0] * self.ey[0] + d[1] * self.ey[1] + d[2] * self.ey[2]
        lz = d[0] * self.ez[0] + d[1] * self.ez[1] + d[2] * self.ez[2]
        rxy = math.hypot(lx, ly)
        phi = math.atan2(ly, lx) if rxy > 1e-12 else 0.0
        cp, sp = math.cos(phi), math.sin(phi)
        if self.kind == "C":
            # (v_r, v_θ, v_z) → 국부 직교: e_r=(cosθ, sinθ, 0), e_θ=(−sinθ, cosθ, 0)
            return self._rotate(a * cp - b * sp, a * sp + b * cp, c)
        # 구: θ = z 축에서 잰 극각, φ = 방위각. e_r=(sθcφ, sθsφ, cθ), e_θ=(cθcφ, cθsφ, −sθ), e_φ=(−sφ, cφ, 0)
        th = math.atan2(rxy, lz) if (rxy > 1e-12 or abs(lz) > 1e-12) else 0.0
        ct, st = math.cos(th), math.sin(th)
        return self._rotate(a * st * cp + b * ct * cp - c * sp,
                            a * st * sp + b * ct * sp + c * cp,
                            a * ct - b * st)


BASIC = CoordSystem("R", (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def from_points(kind: str, a: Vec, b: Vec, c: Vec) -> CoordSystem:
    ez = _unit(_sub(b, a))
    ey = _unit(_cross(ez, _sub(c, a)))
    ex = _cross(ey, ez)
    return CoordSystem(kind, a, ex, ey, ez)


def resolve_coords(raw_grids: dict[int, tuple[int, float, float, float]],
                   coord_defs: list[tuple], *,
                   systems: dict[int, CoordSystem] | None = None) -> tuple[dict[int, Vec], int, list[int]]:
    """raw_grids: gid → (cp, x, y, z). coord_defs: ("2", kind, cid, rid, [9 실수]) | ("1", kind, cid, None, [g1, g2, g3]).
    반환: (gid → 전역 좌표, 풀지 못한 GRID 수, 퇴화한 좌표계 cid 목록).
    systems 에 빈 dict 를 넘기면 풀린 좌표계(cid → CoordSystem, 0 = 기본)를 채워 준다."""
    if systems is None:
        systems = {}
    systems.clear()
    systems[0] = BASIC
    nodes: dict[int, Vec] = {}
    pending = dict(raw_grids)
    defs = list(coord_defs)
    bad: list[int] = []
    progress = True
    while progress:
        progress = False
        for gid, (cp, x, y, z) in list(pending.items()):
            cs = systems.get(cp)
            if cs is not None:
                nodes[gid] = cs.to_basic((x, y, z))
                del pending[gid]
                progress = True
        for d in list(defs):
            form, kind, cid, rid, vals = d
            if form == "2":
                ref = systems.get(rid)
                if ref is None:
                    continue
                a, b, c = ref.to_basic(vals[0:3]), ref.to_basic(vals[3:6]), ref.to_basic(vals[6:9])
            else:
                if not all(g in nodes for g in vals):
                    continue
                a, b, c = (nodes[g] for g in vals)
            defs.remove(d)
            progress = True
            try:
                systems[cid] = from_points(kind, a, b, c)
            except ValueError:
                bad.append(cid)
    return nodes, len(pending), bad
