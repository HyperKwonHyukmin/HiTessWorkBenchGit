"""model.lbm — 브라우저 뷰어용 gzip 바이너리(설계 §7.2). 형식은 04a 계획서 Task 3 표를 따른다.

형식 v2(04c 계획서 §1): v1 블록은 그대로 두고 beams 와 행이 맞는 두 블록을 더한다.
    beam_orient  f4 × 3  기본 좌표계 단위 방향 벡터 v(없으면 0,0,0)
    beam_offsets f4 × 6  기본 좌표계 WA(3)·WB(3)(없으면 0)
"""
import gzip
import json
import struct

import numpy as np

from .model import BEAM_CARDS, QUAD_CARDS, RIGID_CARDS, TRI_CARDS, Model

MAGIC = b"LBM1"
VERSION = 2                 # ModelSummary.format_version 에 남는다 — 올리면 파생물 경로·ETag 가 바뀐다
MAX_WARNINGS = 50
_ZERO3 = (0.0, 0.0, 0.0)
_ZERO6 = (0.0,) * 6


def _arr(rows, dtype, width: int) -> np.ndarray:
    a = np.array(rows, dtype=dtype)
    return a.reshape(-1, width) if width > 1 else a.reshape(-1)


def _finite_f4(rows, width: int) -> np.ndarray:
    """f4 로 바꾸며 넘친 값(|x| > 3.4e38 → inf)을 0 으로 — NaN/inf 가 뷰어로 나가지 않게."""
    with np.errstate(over="ignore"):
        a = _arr(rows, "<f4", width)
    if a.size and not np.isfinite(a).all():
        a[~np.isfinite(a)] = 0.0
    return a


def build_blocks(m: Model) -> dict[str, np.ndarray]:
    ids = sorted(m.nodes)
    idx = {nid: i for i, nid in enumerate(ids)}
    rigid_lines, rigid_kinds = [], []
    for r in m.rigids:
        for o in r.others:
            rigid_lines.append((r.eid, idx[r.center], idx[o]))
            rigid_kinds.append(RIGID_CARDS.index(r.card))
    return {
        "node_ids": _arr(ids, "<i4", 1),
        "node_xyz": _arr([m.nodes[n] for n in ids], "<f4", 3),
        "beams": _arr([(e.eid, e.pid, idx[e.nodes[0]], idx[e.nodes[1]]) for e in m.beams], "<i4", 4),
        "beam_cards": _arr([BEAM_CARDS.index(e.card) for e in m.beams], "|u1", 1),
        "beam_orient": _finite_f4([e.v or _ZERO3 for e in m.beams], 3),
        "beam_offsets": _finite_f4([e.off or _ZERO6 for e in m.beams], 6),
        "tris": _arr([(e.eid, e.pid, *(idx[n] for n in e.nodes)) for e in m.tris], "<i4", 5),
        "tri_cards": _arr([TRI_CARDS.index(e.card) for e in m.tris], "|u1", 1),
        "quads": _arr([(e.eid, e.pid, *(idx[n] for n in e.nodes)) for e in m.quads], "<i4", 6),
        "quad_cards": _arr([QUAD_CARDS.index(e.card) for e in m.quads], "|u1", 1),
        "rigid_lines": _arr(rigid_lines, "<i4", 3),
        "rigid_kinds": _arr(rigid_kinds, "|u1", 1),
        "masses": _arr([(eid, idx[g]) for eid, g, _ in m.masses], "<i4", 2),
        "mass_values": _arr([mass for _, _, mass in m.masses], "<f4", 1),
        "spcs": _arr([(idx[g], int(comp)) for g, comp in sorted(m.spcs.items()) if comp.isdigit()], "<i4", 2),
    }


def write_lbm(m: Model) -> bytes:
    blocks = build_blocks(m)
    body = bytearray()
    metas = {}
    for name, arr in blocks.items():
        body += b"\0" * (-len(body) % 4)
        metas[name] = {"offset": len(body), "dtype": arr.dtype.str, "count": int(arr.shape[0]),
                       "width": int(arr.shape[1]) if arr.ndim == 2 else 1}
        body += arr.tobytes()
    header = {
        "version": VERSION, "bbox": m.bbox(), "counts": m.counts(), "sol": m.sol,
        "warnings": m.warnings[:MAX_WARNINGS], "unsupported": m.unsupported,
        "properties": {str(k): v for k, v in sorted(m.properties.items())},
        "materials": {str(k): v for k, v in sorted(m.materials.items())},
        "conrods": {str(k): v for k, v in sorted(m.conrods.items())},
        "cards": {"beam": list(BEAM_CARDS), "tri": list(TRI_CARDS), "quad": list(QUAD_CARDS),
                  "rigid": list(RIGID_CARDS)},
        "blocks": metas,
    }
    # allow_nan=False — NaN/Infinity 는 브라우저 JSON.parse 가 못 읽는다(parse_float 가 막지만 마지막 방어선)
    hj = json.dumps(header, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    hj += b" " * (-len(hj) % 4)
    return gzip.compress(MAGIC + struct.pack("<I", len(hj)) + hj + bytes(body), compresslevel=6)


def read_lbm(data: bytes) -> tuple[dict, dict[str, np.ndarray]]:
    raw = gzip.decompress(data)
    if raw[:4] != MAGIC:
        raise ValueError("LBM 형식이 아닙니다")
    (hlen,) = struct.unpack("<I", raw[4:8])
    header = json.loads(raw[8:8 + hlen].decode("utf-8"))
    body = memoryview(raw)[8 + hlen:]
    blocks = {}
    for name, meta in header["blocks"].items():
        dt = np.dtype(meta["dtype"])
        n = meta["count"] * meta["width"]
        a = np.frombuffer(body, dtype=dt, count=n, offset=meta["offset"]).copy()
        blocks[name] = a.reshape(-1, meta["width"]) if meta["width"] > 1 else a
    return header, blocks
