"""BDF 덱 읽기 — 줄을 카드(이름 + 필드)로 묶는다.

필드 위치를 형식과 무관하게 맞추려고 **물리 줄마다 데이터 8칸**을 채운다(대형 필드는 줄당 4칸이라
두 줄이 8칸). 그래서 PBARL 의 DIM1 은 고정·자유 형식 모두 fields[8] 에 있다.
고정 필드의 10번째 칸(연속 표시, 73~80열)은 데이터에 넣지 않는다 — WorkBench 판이 섞던 부분이다.

메모리: 파일 바이트는 한 번에 읽지만, 디코드는 줄 단위로 한다(디코드된 거대 문자열 + 전체 줄 목록을
동시에 들지 않는다). 본 파일과 INCLUDE 를 합친 바이트 상한(max_bytes)을 넘으면 DeckTooLarge.

raw_sink(06 해석 검증): 주면 Bulk 구간의 줄 원문(주석 `$…` 만 뗀 것)을 읽는 순서대로 넘긴다. INCLUDE 줄은
넘기지 않고 그 자리에서 포함 파일의 줄이 이어지므로, 받은 줄을 이으면 INCLUDE 가 풀린 Bulk 한 덩어리가 된다.
BEGIN BULK·ENDDATA·빈 줄은 넘기지 않는다.

control(12 내용 서명): Bulk 앞 실행·케이스 제어 줄(주석 `$…` 만 뗀 것)을 읽는 순서대로 모은다(SOL·CEND·
SUBCASE·LOAD= …). INCLUDE·BEGIN BULK 줄은 넣지 않는다. 줄 수 상한(MAX_CONTROL_LINES)을 넘으면 더 모으지 않고
경고 control_truncated 를 남긴다.
"""
import hashlib
import posixpath
import re
from dataclasses import dataclass
from typing import Callable

_SOL = re.compile(r"^\s*SOL\s+([A-Za-z0-9]+)", re.IGNORECASE)
_BEGIN = re.compile(r"^\s*BEGIN\s+BULK", re.IGNORECASE)
_ENDDATA = re.compile(r"^\s*ENDDATA", re.IGNORECASE)
_INCLUDE = re.compile(r"^\s*INCLUDE\b", re.IGNORECASE)
# BEGIN BULK 이 빠진 덱에서 Bulk 시작으로 보는 카드 이름. LOAD·SPC 처럼 Case Control 에도 쓰이는 이름은
# '=' 가 있는 줄을 따로 거른다. PARAM 은 Case Control 에 그대로 올 수 있어 넣지 않는다.
_BULK_START = re.compile(
    r"^(?:GRID|CBAR|CBEAM|CROD|CONROD|CTUBE|CQUAD4|CQUAD8|CQUADR|CTRIA3|CTRIA6|CTRIAR|CSHEAR|CELAS[1-4]|CBUSH|CGAP|"
    r"RBE2|RBE3|RBAR|RROD|CONM1|CONM2|CMASS[1-4]|PBAR|PBARL|PBEAM|PBEAML|PROD|PTUBE|PSHELL|PCOMP|PSHEAR|PELAS|PBUSH|"
    r"MAT1|MAT2|MAT8|MAT9|CORD1[RCS]|CORD2[RCS]|SPC1?|SPCADD|FORCE|MOMENT|GRAV|PLOAD[124]?|TEMPD?)\*?(?:[\s,]|$)",
    re.IGNORECASE)
_QUOTED = re.compile(r"'([^']*)'")
_BARE = re.compile(r"INCLUDE\s+(\S+)", re.IGNORECASE)
_ABSOLUTE = re.compile(r"^(?:[A-Za-z]:/|//|/)")
_EOL = re.compile(rb"\r\n|\r|\n")
# 본 파일 바이트 사전 검사 — 줄 시작(파일 처음 또는 줄바꿈 뒤)의 BEGIN BULK / 실행·케이스 제어(SOL·CEND)
_BEGIN_BYTES = re.compile(rb"(?:^|[\r\n])[ \t]*BEGIN[ \t]+BULK", re.IGNORECASE)
_EXEC_BYTES = re.compile(rb"(?:^|[\r\n])[ \t]*(?:SOL[ \t]+[A-Za-z0-9]|CEND\b)", re.IGNORECASE)
MAX_INCLUDE_DEPTH = 10
MAX_INCLUDE_JOIN_LINES = 5     # 따옴표가 안 닫힌 INCLUDE 를 이어 붙이는 최대 줄 수
MAX_INCLUDE_JOIN_CHARS = 256   # … 와 최대 글자 수
MAX_NAME_CHARS = 200           # missing·경고에 남기는 INCLUDE 이름 길이
MAX_CONTROL_LINES = 20000      # 실행·케이스 제어 줄을 모으는 상한(내용 서명용, 12)


class DeckTooLarge(Exception):
    """본 파일 + INCLUDE 바이트 합이 상한을 넘었다(OSError 가 아니다 — INCLUDE '없음' 으로 삼키지 않는다)."""


def _iter_lines(data: bytes):
    """bytes.splitlines() 와 같은 경계(\r\n·\r·\n)로 자르되, 줄 목록을 만들지 않고 하나씩 디코드해 내준다."""
    pos, n = 0, len(data)
    while pos < n:
        m = _EOL.search(data, pos)
        if m is None:
            yield data[pos:].decode("utf-8", errors="replace")
            return
        yield data[pos:m.start()].decode("utf-8", errors="replace")
        pos = m.end()


@dataclass(slots=True)
class Card:
    name: str
    fields: list[str]
    source: str


def _free(line: str) -> list[str]:
    data = [t.strip() for t in line.split(",")][1:]
    # 9번째 칸이 빈칸·+…·*… 이면 연속 표시다. 숫자면 WorkBench 식 긴 줄(예: RBE2 종속 절점)이라 살린다.
    if len(data) == 9 and (not data[8] or data[8][0] in "+*"):
        return data[:8]
    if len(data) < 8:
        data += [""] * (8 - len(data))
    return data                   # 8칸 넘는 긴 자유 형식 줄(WorkBench 출력)은 그대로 잇는다


def _small(line: str) -> list[str]:
    return [line[8 + 8 * k:16 + 8 * k].strip() for k in range(8)]


def _large(line: str) -> list[str]:
    return [line[8 + 16 * k:24 + 16 * k].strip() for k in range(4)]


def _first_line(line: str) -> tuple[str, list[str]]:
    if "," in line:
        return line.split(",", 1)[0].strip().upper().rstrip("*"), _free(line)
    name = line[:8].strip().upper()
    if name.endswith("*"):
        return name[:-1], _large(line)
    return name, _small(line)


def _continuation(line: str) -> list[str]:
    if "," in line:
        return _free(line)
    if line.startswith("*"):
        return _large(line)
    return _small(line)


class DeckReader:
    """opener(rel_posix) → bytes. 본 파일을 못 읽으면 opener 의 예외가 그대로 올라간다."""

    def __init__(self, opener: Callable[[str], bytes], *, max_bytes: int | None = None,
                 raw_sink: Callable[[str], None] | None = None):
        self.opener = opener
        self.max_bytes = max_bytes
        self.raw_sink = raw_sink
        self.total_bytes = 0
        self._bulk = True       # 벌크 데이터 구간인가 — INCLUDE 사슬을 따라 이어진다
        self._ended = False     # ENDDATA 를 만났다(INCLUDE 안이어도 덱 전체가 끝난다)
        self.cards: list[Card] = []
        self.sol: str | None = None
        self.warnings: list[str] = []
        self.includes: list[str] = []
        self.missing: list[str] = []
        self.control: list[str] = []   # Bulk 앞 실행·케이스 제어 줄(12 내용 서명)
        self._seen: set[str] = set()
        self._hash = hashlib.sha256()

    @property
    def digest(self) -> str:
        """본 파일과 INCLUDE 파일 바이트를 읽은 순서대로 이은 sha256 — 파생물 열쇠."""
        return self._hash.hexdigest()

    def read(self, rel: str) -> list[Card]:
        self._read_file(rel, depth=0, main=True)
        return self.cards

    def _read_file(self, rel: str, depth: int, main: bool) -> bool:
        """파일을 읽어 카드를 더한다. 이미 읽은 파일(INCLUDE 순환)이면 False."""
        key = rel.casefold()
        if key in self._seen:
            self.warnings.append(f"include_loop: {rel}")
            return False
        self._seen.add(key)
        data = self.opener(rel)
        self.total_bytes += len(data)
        if self.max_bytes is not None and self.total_bytes > self.max_bytes:
            raise DeckTooLarge(rel)
        self._hash.update(rel.encode("utf-8") + b"\0")   # 둘로 나눠 넣어 data 사본을 만들지 않는다(해시는 같다)
        self._hash.update(data)
        if main:
            # 본 파일에 BEGIN BULK 가 있거나, 없어도 실행·케이스 제어(SOL·CEND)가 보이면 비벌크로 시작한다.
            # 비벌크 상태는 INCLUDE 로 이어지므로, BEGIN BULK 가 INCLUDE 안에만 있어도 그 뒤부터 카드가 된다.
            self._bulk = not (_BEGIN_BYTES.search(data) or _EXEC_BYTES.search(data))
        lines = _iter_lines(data)
        current: Card | None = None
        for raw in lines:
            line = raw.expandtabs(8).split("$", 1)[0].rstrip()
            if not self._bulk:
                m = _SOL.match(line)
                if m and self.sol is None:
                    self.sol = m.group(1).upper()
                if _BEGIN.match(line):
                    self._bulk = True
                    continue
                if _BULK_START.match(line) and "=" not in line:
                    # BEGIN BULK 없이 Case Control 뒤에 바로 Bulk 가 온 덱(Nastran 은 FATAL) — 여기서부터 카드로 읽는다
                    self._bulk = True
                    self.warnings.append("missing_begin_bulk")
                elif _INCLUDE.match(line):
                    self._include_line(rel, line, lines, depth)
                    if self._ended:
                        break
                    continue
                else:
                    self._keep_control(line)
                    continue
            if not line.strip():
                continue
            if _BEGIN.match(line):
                continue                      # 벌크 안의 BEGIN BULK(INCLUDE 파일 머리 등)는 카드가 아니다
            if _ENDDATA.match(line):
                self._ended = True
                break
            if _INCLUDE.match(line):
                current = None
                self._include_line(rel, line, lines, depth)
                if self._ended:
                    break
                continue
            if self.raw_sink is not None:
                self.raw_sink(raw.split("$", 1)[0].rstrip())   # 탭·칸 배치는 원문 그대로
            stripped = line.lstrip()
            if len(stripped) < len(line) and stripped[:1] in ("+", "*", ",") and "," in stripped:
                line = stripped               # 앞에 공백이 붙은 자유 형식 연속 줄(' +,7,8')
            if line[0] in "+*," or not line[:8].strip():
                if current is not None:
                    current.fields.extend(_continuation(line))
                continue
            name, fields = _first_line(line)
            current = Card(name, fields, rel)
            self.cards.append(current)
        return True

    def _keep_control(self, line: str) -> None:
        if not line.strip():
            return
        if len(self.control) >= MAX_CONTROL_LINES:
            if "control_truncated" not in self.warnings:
                self.warnings.append("control_truncated")
            return
        self.control.append(line.strip())

    def _include_line(self, rel: str, line: str, lines, depth: int) -> None:
        """INCLUDE 한 줄(따옴표가 안 닫혔으면 다음 줄을 정해진 만큼 잇는다)을 처리한다."""
        text = line
        joined = 0
        while (text.count("'") == 1 and joined < MAX_INCLUDE_JOIN_LINES
               and len(text) <= MAX_INCLUDE_JOIN_CHARS):
            nxt = next(lines, None)
            if nxt is None:
                break
            text += nxt.split("$", 1)[0].strip()
            joined += 1
        if text.count("'") == 1:
            self.warnings.append(f"include_unreadable: {text[:80]}")
            return
        self._include(rel, text, depth)

    def _include(self, rel: str, text: str, depth: int) -> None:
        m = _QUOTED.search(text) or _BARE.search(text)
        name = (m.group(1) if m else "").strip()
        if not name:
            self.warnings.append(f"include_unreadable: {text[:80]}")
            return
        try:
            target = self._resolve(rel, name)
            if depth + 1 > MAX_INCLUDE_DEPTH:
                raise ValueError("depth")
            # 순환(이미 읽은 파일)은 경고만 남기고 includes 에 넣지 않는다
            if self._read_file(target, depth + 1, main=False) and target not in self.includes:
                self.includes.append(target)
        except (OSError, ValueError):
            short = name[:MAX_NAME_CHARS]
            self.missing.append(short)
            self.warnings.append(f"include_missing: {short}")

    @staticmethod
    def _resolve(rel: str, name: str) -> str:
        name = name.replace("\\", "/")
        if _ABSOLUTE.match(name):
            name = posixpath.basename(name)   # 개인 PC 절대경로 — 같은 폴더에서 이름으로 찾는다
        joined = posixpath.normpath(posixpath.join(posixpath.dirname(rel), name))
        if joined == ".." or joined.startswith("../") or joined.startswith("/"):
            raise ValueError(f"루트 밖 경로: {name}")
        return joined
