# -*- coding: utf-8 -*-
"""Hi-TESS 개발 연대기(/history) — git 기록에서 숫자를 다시 뽑아 HistoryWeb/data.auto.js 를 만든다.

쓰는 법(70 개발 PC, 저장소 루트에서):  python -X utf8 scripts/history_build.py
  - 주간·월별 작업량(커밋 수), 버전이 시작된 날, 달별 버전 범위가 갱신된다.
  - 앱 등장·주요 변화·시기처럼 사람이 정하는 내용은 HistoryWeb/data.events.js 를 손으로 고친다.
  - 만든 파일을 커밋·푸시하면 145 는 git pull 만으로 반영된다(재시작 불필요).
⚠ 145 에서 돌리지 말 것 — Studio·엔진 저장소(WorkBenchSubModule)가 없어 그 줄이 0 이 된다.
없는 저장소는 건너뛰고 끝에 알려 준다(PC 마다 받아 둔 저장소가 다를 수 있다).
"""
import collections
import datetime
import json
import os
import re
import subprocess

WB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 저장소 루트
CODING = os.path.dirname(WB)
SUB = os.path.join(CODING, 'WorkBenchSubModule')
OUT_DIR = os.path.join(WB, 'HiTessWorkBenchBackEnd', 'HistoryWeb')

# 줄(계열)마다 저장소 묶음. 같은 커밋이 두 저장소에 있으면(MB·MU Studio 공유 이력) 한 번만 센다.
GROUPS = {
    'wb': [WB],
    'sub': [os.path.join(SUB, n) for n in (
        'ModelBuilderStudio', 'ModuleUnitStudio', 'SidePassageStudio', 'MooringFittingStudio',
        'PlateAnalysisStudio', 'HiTessModelBuilder', 'MooringFitting', 'ModuleUnitAnalysis',
        'CarlingCalculation', 'D_TypeLugCalculation', 'ColumnBucklingWorkingLoadCalculator',
        'PostDavitCalculation', 'LngTank', 'LugShell', 'HiTessMBClient')],
    'logbook': [os.path.join(CODING, 'Logbook')],
}


def git(repo, *args):
    r = subprocess.run(['git', '-C', repo, *args], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    return r.stdout


def commits(repo):
    """(해시, 날짜, 제목) 목록. 병합 커밋 제외, 모든 브랜치(로컬·원격).
    --all 은 쓰지 않는다 — stash('WIP on …')와 태그까지 세어 숫자가 PC 의 stash 상태에 따라 달라진다."""
    out = git(repo, 'log', '--branches', '--remotes', '--no-merges', '--format=%H\x01%ad\x01%s', '--date=short')
    rows = []
    for line in out.splitlines():
        parts = line.split('\x01')
        if len(parts) == 3:
            rows.append(parts)
    return rows


def monday(d):
    return d - datetime.timedelta(days=d.weekday())


def main():
    by_group = {}
    skipped = []
    for key, repos in GROUPS.items():
        seen = {}
        for repo in repos:
            if not os.path.isdir(os.path.join(repo, '.git')):
                skipped.append(repo)
                continue
            for h, d, s in commits(repo):
                seen[h] = (d, s)
        by_group[key] = seen

    wb_dates = [datetime.date.fromisoformat(d) for d, _ in by_group['wb'].values()]
    first, today = min(wb_dates), datetime.date.today()
    start = monday(first)
    n_weeks = (monday(today) - start).days // 7 + 1

    weeks, months = {}, collections.defaultdict(lambda: collections.Counter())
    for key, seen in by_group.items():
        arr = [0] * n_weeks
        for d, _ in seen.values():
            dt = datetime.date.fromisoformat(d)
            if dt < start:
                continue
            arr[(dt - start).days // 7] += 1
            months[d[:7]][key] += 1
        weeks[key] = arr

    # 버전: 'release' 또는 '버전 X.Y.Z' 커밋 제목의 첫 버전 번호.
    # Studio 버전핀 줄(번호 앞에 studio 가 나옴)과 studio-release 는 뺀다.
    ver_re = re.compile(r'v?(\d+)\.(\d+)\.(\d+)')
    minor_first, month_range, latest = {}, {}, (0, 0, 0)
    for d, s in by_group['wb'].values():
        low = s.lower()
        if 'studio-release' in low or not ('release' in low or re.search(r'버전\s*v?\d+\.\d+\.\d+', s)):
            continue
        m = ver_re.search(s)
        if not m or 'studio' in low[:m.start()]:
            continue
        v = tuple(int(x) for x in m.groups())
        latest = max(latest, v)
        mk = v[:2]
        if mk not in minor_first or d < minor_first[mk]:
            minor_first[mk] = d
        lo, hi = month_range.get(d[:7], (v, v))
        month_range[d[:7]] = (min(lo, v), max(hi, v))

    fmt = lambda v: 'v' + '.'.join(str(x) for x in v)
    data = {
        'generated': today.isoformat(),
        'first': first.isoformat(),
        'start': start.isoformat(),
        'weeks': weeks,
        'months': {k: dict(v) for k, v in sorted(months.items()) if k >= first.isoformat()[:7]},
        'versions': [[f'v{a}.{b}', d] for (a, b), d in sorted(minor_first.items())],
        'monthVersions': {k: [fmt(lo), fmt(hi)] for k, (lo, hi) in sorted(month_range.items())},
        'latest': fmt(latest),
        'totals': {k: len(v) for k, v in by_group.items()},
    }
    path = os.path.join(OUT_DIR, 'data.auto.js')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// scripts/history_build.py 가 만든 파일 — 손으로 고치지 않는다.\n')
        f.write('window.HISTORY_AUTO = ' + json.dumps(data, ensure_ascii=False) + ';\n')

    print('만든 파일:', path)
    print('기간:', first, '~', today, f'({n_weeks}주)', '· 현재 버전', data['latest'])
    print('작업 기록:', data['totals'])
    print('버전 시작일:', data['versions'])
    if skipped:
        print('없어서 건너뛴 저장소(그 줄이 실제보다 작게 나온다):', *skipped, sep='\n  ')


if __name__ == '__main__':
    main()
