"""BDF → model.lbm 변환(All Projects 3D 미리보기). LogBook convert/job.py 의 convert_deck 를 줄인 판이다.

- 썸네일·지문·서명은 만들지 않는다(미리보기에 필요 없음). 결과는 디스크에 쓰지 않고 바이트로 돌려준다(DRM).
- INCLUDE 는 작업 폴더(root) 안에서만 따라간다 — DeckReader._resolve 가 루트 밖 경로를 거부한다.
- 같은 파일(경로·크기·수정 시각)은 최근 몇 개를 메모리에 둔다. 큰 모델을 다시 열 때 다시 읽지 않게.
"""
from __future__ import annotations

import os
import threading
from collections import OrderedDict

from .deck import DeckReader, DeckTooLarge
from .lbm import VERSION as LBM_VERSION, write_lbm
from .model import ModelError, build_model

# WorkBench 서버는 해석 작업과 메모리를 같이 쓴다 — LogBook(600MB, 별도 프로세스)보다 낮게 둔다
MAX_PREVIEW_BYTES = 200 * 1024 ** 2
CACHE_SIZE = 4
DRM_MAGIC = b"HHIDRMC"

_cache: "OrderedDict[tuple, dict]" = OrderedDict()
_lock = threading.Lock()


class PreviewError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class _Encrypted(OSError):
    pass


def _opener(root: str, max_bytes: int):
    def read(rel: str) -> bytes:
        with open(os.path.join(root, *rel.split("/")), "rb") as fh:
            if os.fstat(fh.fileno()).st_size > max_bytes:
                raise DeckTooLarge(rel)
            data = fh.read()
        if data.startswith(DRM_MAGIC):
            raise _Encrypted(rel)
        return data
    return read


def build_preview(root: str, rel_path: str, *, max_bytes: int = MAX_PREVIEW_BYTES) -> dict:
    """→ {"lbm": bytes, "version": int, "counts": dict, "warnings": list, "missing": list}. 실패는 PreviewError."""
    full = os.path.join(root, *rel_path.split("/"))
    st = os.stat(full)
    key = (os.path.normcase(full), st.st_size, st.st_mtime_ns)
    with _lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
            return hit

    reader = DeckReader(_opener(root, max_bytes), max_bytes=max_bytes)
    try:
        cards = reader.read(rel_path)
    except _Encrypted:
        raise PreviewError(422, "회사 DRM 으로 암호화된 파일이라 읽을 수 없습니다.")
    except DeckTooLarge:
        raise PreviewError(413, f"미리보기 상한({max_bytes // 1024 ** 2}MB, INCLUDE 포함)을 넘는 파일입니다.")
    except MemoryError:
        raise PreviewError(507, "모델이 너무 커서 서버 메모리가 부족합니다.")
    try:
        model = build_model(cards, sol=reader.sol, warnings=reader.warnings,
                            includes=reader.includes, missing=reader.missing)
        if model.element_total() == 0:
            raise PreviewError(422, "요소(CBAR·CQUAD4 등)가 없어 3D 로 보여 줄 것이 없습니다.")
        data = write_lbm(model)
    except ModelError as exc:
        raise PreviewError(422, f"모델을 만들 수 없습니다({exc}).")
    except MemoryError:
        raise PreviewError(507, "모델이 너무 커서 서버 메모리가 부족합니다.")
    out = {"lbm": data, "version": LBM_VERSION, "counts": model.counts(),
           "warnings": list(model.warnings), "missing": list(reader.missing)}
    with _lock:
        _cache[key] = out
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return out


def clear_cache() -> None:
    with _lock:
        _cache.clear()
