"""짝 Studio 싱크 검사 — 한 Studio 를 고치면 짝 Studio 에도 들여와야 하는 파일을 찾는다.

Studio 들은 저장소가 따로라 셸·찾기·도움말 같은 코드를 사본으로 나눠 갖는다. 그 사본이 어긋나는지를
주석과 기억에만 맡기지 않으려고 만든 검사다. 규칙(어느 Studio 가 짝인지, 어느 파일이 같아야 하는지)은
`scripts/studio_pair.json`, 지켜보는 파일의 '마지막으로 살펴본 내용'은 `scripts/studio_pair.lock.json` 에 있다.

  python scripts/studio_pair.py                      # 검사 (같아야 하는 파일 + 지켜보는 짝)
  python scripts/studio_pair.py --group mb-mu        # 한 묶음만
  python scripts/studio_pair.py --ack --all          # 지켜보는 짝을 지금 내용으로 '살펴봄' 처리
  python scripts/studio_pair.py --ack <경로> […]     # 그 파일만 '살펴봄' 처리
  python scripts/studio_pair.py --scan <id> <id>     # 두 Studio 의 같은 경로 파일을 훑어 분류(새 짝을 등록할 때)

파일 두 종류:
  same  = 내용이 같아야 한다(줄 끝 CRLF/LF 차이는 무시). 어긋나면 종료 코드 1.
  watch = 짝이지만 달라도 된다. 한쪽이 '살펴본 뒤' 바뀌면 다른 쪽에 들여올지 보라고 알린다(종료 코드에는 영향 없음).
          들여왔거나 해당 없다고 판단했으면 --ack 로 닫는다.

마지막 줄 `SAME_MISMATCH=<n> WATCH_CHANGED=<n>`.
Studio 소스 위치는 저장소 옆 `WorkBenchSubModule`(환경 변수 HITESS_SUBMODULE_ROOT 로 바꿈). 없는 Studio 는 건너뛴다.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import sys
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MANIFEST = os.path.join(ROOT, "scripts", "studio_pair.json")
LOCK = os.path.join(ROOT, "scripts", "studio_pair.lock.json")
DEFAULT_EXTENSIONS = (".js", ".jsx", ".mjs", ".ts", ".tsx", ".css")
SKIP_DIRS = {"node_modules", "dist", "release", ".vite"}
NEAR_LINES = 20  # --scan 에서 '거의 같음' 으로 보는 다른 줄 수


def submodule_root() -> str:
    return os.environ.get("HITESS_SUBMODULE_ROOT") or os.path.abspath(
        os.path.join(ROOT, "..", "WorkBenchSubModule")
    )


def load_json(path: str, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, data) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


def read_norm(path: str) -> bytes | None:
    """파일 내용(줄 끝을 LF 로 맞춤). 없으면 None."""
    try:
        with open(path, "rb") as f:
            return f.read().replace(b"\r\n", b"\n")
    except OSError:
        return None


def digest(data: bytes | None) -> str | None:
    return None if data is None else hashlib.sha1(data).hexdigest()[:16]


def rough_diff_lines(a: bytes | None, b: bytes | None) -> int:
    """한쪽에만 있는 줄 수(순서는 보지 않는 대략값 — 분류용)."""
    ca = Counter((a or b"").decode("utf-8", "replace").splitlines())
    cb = Counter((b or b"").decode("utf-8", "replace").splitlines())
    return sum((ca - cb).values()) + sum((cb - ca).values())


class Studio:
    def __init__(self, sid: str, spec: dict, base: str):
        self.id = sid
        self.label = spec.get("label") or sid
        self.name = spec.get("name") or sid
        self.src = os.path.join(base, *spec["src"].split("/"))

    @property
    def present(self) -> bool:
        return os.path.isdir(self.src)

    def path(self, rel: str) -> str:
        return os.path.join(self.src, *rel.split("/"))

    def files(self, extensions) -> set[str]:
        out: set[str] = set()
        for cur, dirs, names in os.walk(self.src):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for name in names:
                if name.lower().endswith(tuple(extensions)):
                    full = os.path.join(cur, name)
                    out.add(os.path.relpath(full, self.src).replace("\\", "/"))
        return out


def normalize_entry(entry, members: list[str]) -> dict[str, str]:
    """목록 한 줄 → {studio id: 상대 경로}.

    "a/b.js"                               = 묶음의 모든 Studio 에서 같은 경로
    {"path": "a/b.js", "also": ["x"]}      = 거기에 다른 Studio 를 더함(세 곳 이상이 같은 파일을 쓸 때)
    {"paths": {"id1": "p1", "id2": "p2"}}  = Studio 마다 경로가 다름
    """
    if isinstance(entry, str):
        return {m: entry for m in members}
    if "paths" in entry:
        return dict(entry["paths"])
    ids = list(members) + [s for s in entry.get("also", []) if s not in members]
    return {m: entry["path"] for m in ids}


def entry_key(paths: dict[str, str]) -> str:
    return next(iter(paths.values()))


class Report:
    def __init__(self):
        self.lines: list[str] = []
        self.same_mismatch = 0
        self.watch_changed = 0

    def add(self, text: str = "") -> None:
        self.lines.append(text)


def mtime_text(path: str) -> str:
    try:
        return dt.datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%d %H:%M")
    except OSError:
        return "?"


def check_group(group: dict, studios: dict[str, Studio], extensions, lock: dict, rep: Report) -> dict:
    """한 묶음을 검사하고, 지켜보는 짝의 지금 지문({key: {studio: digest}})을 돌려준다."""
    gid = group["id"]
    members = group["members"]
    title = " ↔ ".join(studios[m].name for m in members)
    rep.add(f"[{gid}] {title}")
    missing = [studios[m].name for m in members if not studios[m].present]
    if missing:
        rep.add(f"  건너뜀: 이 PC 에 소스가 없음 ({', '.join(missing)})")
        rep.add()
        return None  # 빈 dict 가 아니라 None — 못 본 묶음의 지문을 --ack --all 이 지우지 않게(리뷰 반영)

    # ── 같아야 하는 파일
    same_entries = [normalize_entry(e, members) for e in group.get("same", [])]
    ok = 0
    problems: list[str] = []
    for paths in same_entries:
        usable = {s: p for s, p in paths.items() if s in studios and studios[s].present}
        skipped = [s for s in paths if s not in usable]
        contents = {s: read_norm(studios[s].path(p)) for s, p in usable.items()}
        absent = [s for s, c in contents.items() if c is None]
        key = entry_key(paths)
        if absent:
            rep.same_mismatch += 1
            problems.append(f"    없음   {key}  — {', '.join(studios[s].label for s in absent)} 에 파일이 없음")
            continue
        digests = {s: digest(c) for s, c in contents.items()}
        if len(set(digests.values())) <= 1:
            ok += 1
            if skipped:
                problems.append(f"    (참고) {key}  — {', '.join(skipped)} 는 이 PC 에 없어 비교하지 않음")
            continue
        rep.same_mismatch += 1
        ids = list(usable)
        base = ids[0]
        parts = []
        for s in ids[1:]:
            if digests[s] != digests[base]:
                n = rough_diff_lines(contents[base], contents[s])
                parts.append(f"{studios[base].label}↔{studios[s].label} 약 {n}줄")
        newest: str = max(ids, key=lambda s: os.path.getmtime(studios[s].path(usable[s])))
        problems.append(
            f"    어긋남 {key}  — {', '.join(parts)} · 최근 수정 {studios[newest].label}"
            f"({mtime_text(studios[newest].path(usable[newest]))})"
        )
    bad = len(same_entries) - ok
    rep.add(f"  같아야 하는 파일 {len(same_entries)}개: 일치 {ok} · 문제 {bad}")
    for line in problems:
        rep.add(line)

    # ── 지켜보는 짝
    ignore = group.get("ignore", {})
    claimed = {entry_key(p) for p in same_entries} | set(ignore)
    watch_spec = group.get("watch", [])
    if watch_spec == "auto":
        common = None
        for m in members:
            files = studios[m].files(extensions)
            common = files if common is None else common & files
        watch_entries = [{m: rel for m in members} for rel in sorted((common or set()) - claimed)]
    else:
        watch_entries = [normalize_entry(e, members) for e in watch_spec]
    for extra in group.get("watch_also", []):  # auto 에 더해, 경로가 다른 짝
        watch_entries.append(normalize_entry(extra, members))

    known = lock.get(gid, {})
    current: dict[str, dict[str, str]] = {}
    unchanged = 0
    new_pairs: list[str] = []
    changed: dict[tuple[str, ...], list[str]] = {}
    identical_now: list[str] = []
    for paths in watch_entries:
        key = entry_key(paths)
        digests = {s: digest(read_norm(studios[s].path(p))) for s, p in paths.items() if s in studios}
        if any(d is None for d in digests.values()):
            continue  # 한쪽에서 사라진 짝은 더 지켜보지 않는다
        digests = {s: d for s, d in digests.items() if d is not None}
        current[key] = digests
        if len(set(digests.values())) == 1:
            identical_now.append(key)
        before = known.get(key)
        if before is None:
            new_pairs.append(key)
            continue
        moved = tuple(s for s in digests if before.get(s) != digests[s])
        if moved:
            changed.setdefault(moved, []).append(key)
        else:
            unchanged += 1
    n_changed = sum(len(v) for v in changed.values())
    rep.watch_changed += n_changed
    rep.add(
        f"  지켜보는 짝 {len(current)}개: 변동 없음 {unchanged} · 바뀜 {n_changed} · 아직 안 살펴봄 {len(new_pairs)}"
    )
    for moved, keys in sorted(changed.items()):
        labels = "·".join(studios[s].label for s in moved)
        others = [studios[m].label for m in members if m not in moved]
        hint = f" → {'·'.join(others)} 에 들여올지 검토" if others else " → 양쪽이 따로 바뀜, 서로 맞는지 검토"
        rep.add(f"    {labels} 쪽이 바뀜{hint}")
        for key in keys:
            rep.add(f"      {key}")
    if new_pairs:
        shown = new_pairs[:8]
        rep.add(f"    아직 안 살펴본 짝(--ack 로 기준을 잡는다): {', '.join(shown)}" + (" …" if len(new_pairs) > 8 else ""))
    if identical_now:
        rep.add(f"    지금 내용이 같은 짝 {len(identical_now)}개 — same 목록에 올릴 후보:")
        for key in identical_now:
            rep.add(f"      {key}")
    rep.add()
    return current


def run_check(manifest: dict, only_group: str | None, ack: list[str] | None, ack_all: bool) -> int:
    base = submodule_root()
    studios = {sid: Studio(sid, spec, base) for sid, spec in manifest["studios"].items()}
    extensions = tuple(manifest.get("extensions") or DEFAULT_EXTENSIONS)
    lock_doc = load_json(LOCK, {}) or {}
    lock = lock_doc.get("watch", {})
    rep = Report()
    acked = 0
    for group in manifest["groups"]:
        if only_group and group["id"] != only_group:
            continue
        current = check_group(group, studios, extensions, lock, rep)
        if current is None:
            # 소스가 없어 못 본 묶음은 지문을 건드리지 않는다. 건드리면 Studio 소스가 없는 PC 에서
            # --ack --all 한 번에 기준선이 전부 지워지고, 그 파일이 커밋되면 70 의 변경 감지가 사라진다.
            if ack_all or ack:
                print(f"건너뜀: [{group['id']}] 이 PC 에 Studio 소스가 없어 살펴봄 처리를 하지 않았습니다.")
            continue
        if ack_all or ack:
            slot = lock.setdefault(group["id"], {})
            for key, digests in current.items():
                if ack_all or key in ack:
                    if slot.get(key) != digests:
                        slot[key] = digests
                        acked += 1
            for key in [k for k in slot if k not in current and ack_all]:
                del slot[key]  # 더는 짝이 아닌 기록은 치운다
    if ack_all or ack:
        save_json(LOCK, {"_doc": "studio_pair.py 가 쓰는 파일 — 지켜보는 짝을 마지막으로 살펴본 때의 내용 지문. 손으로 고치지 않는다.", "watch": lock})
        print(f"살펴봄 처리 {acked}건 → {os.path.relpath(LOCK, ROOT)}")
        if ack and not ack_all:
            unknown = [k for k in ack if not any(k in lock.get(g["id"], {}) for g in manifest["groups"])]
            for k in unknown:
                print(f"  ⚠ 짝 목록에 없는 경로: {k}")
        return 0
    print("\n".join(rep.lines))
    print(f"SAME_MISMATCH={rep.same_mismatch} WATCH_CHANGED={rep.watch_changed}")
    return 1 if rep.same_mismatch else 0


def run_scan(manifest: dict, a_id: str, b_id: str, verbose: bool = False) -> int:
    base = submodule_root()
    extensions = tuple(manifest.get("extensions") or DEFAULT_EXTENSIONS)
    try:
        a = Studio(a_id, manifest["studios"][a_id], base)
        b = Studio(b_id, manifest["studios"][b_id], base)
    except KeyError as e:
        print(f"studio_pair.json 의 studios 에 없는 id: {e}")
        return 2
    for s in (a, b):
        if not s.present:
            print(f"이 PC 에 소스가 없음: {s.src}")
            return 2
    fa, fb = a.files(extensions), b.files(extensions)
    common = sorted(fa & fb)
    identical, near, far = [], [], []
    for rel in common:
        ca, cb = read_norm(a.path(rel)), read_norm(b.path(rel))
        if ca == cb:
            identical.append(rel)
            continue
        n = rough_diff_lines(ca, cb)
        (near if n <= NEAR_LINES else far).append((rel, n))
    print(f"{a.name}({len(fa)}) ↔ {b.name}({len(fb)}) — 경로가 같은 파일 {len(common)}개")
    print(f"  내용 같음 {len(identical)} · 거의 같음(다른 줄 {NEAR_LINES} 이하) {len(near)} · 갈라짐 {len(far)}")
    print(f"  한쪽에만: {a.label} {len(fa - fb)} · {b.label} {len(fb - fa)}")
    if identical:
        print("  [내용 같음]")
        for rel in identical:
            print(f"    {rel}")
    if near:
        print("  [거의 같음]")
        for rel, n in sorted(near, key=lambda x: x[1]):
            print(f"    {rel}  (약 {n}줄)")
    if far and verbose:
        print("  [갈라짐]")
        for rel, n in sorted(far, key=lambda x: x[1]):
            print(f"    {rel}  (약 {n}줄)")
    names_a = {}
    for rel in fa - fb:
        names_a.setdefault(os.path.basename(rel), []).append(rel)
    moved = [(names_a[os.path.basename(rel)][0], rel) for rel in sorted(fb - fa) if os.path.basename(rel) in names_a]
    if moved:
        print("  [이름은 같고 경로가 다름]")
        for ra, rb in moved:
            print(f"    {a.label} {ra}  ↔  {b.label} {rb}")
    return 0


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="짝 Studio 싱크 검사")
    ap.add_argument("--group", help="한 묶음만 검사")
    ap.add_argument("--ack", nargs="*", metavar="경로", help="지켜보는 짝을 '살펴봄' 처리(경로 없이 쓰려면 --all)")
    ap.add_argument("--all", action="store_true", help="--ack 와 함께: 모든 지켜보는 짝")
    ap.add_argument("--scan", nargs=2, metavar="STUDIO", help="두 Studio 의 같은 경로 파일을 훑어 분류")
    ap.add_argument("-v", "--verbose", action="store_true", help="--scan 과 함께: 갈라진 파일도 나열")
    args = ap.parse_args(argv)
    manifest = load_json(MANIFEST)
    if manifest is None:
        print(f"규칙 파일이 없음: {MANIFEST}")
        return 2
    if args.scan:
        return run_scan(manifest, args.scan[0], args.scan[1], args.verbose)
    if args.ack is not None and not args.ack and not args.all:
        print("--ack 에는 경로를 주거나 --all 을 붙인다.")
        return 2
    return run_check(manifest, args.group, args.ack, bool(args.ack is not None and args.all))


if __name__ == "__main__":
    sys.exit(main())
