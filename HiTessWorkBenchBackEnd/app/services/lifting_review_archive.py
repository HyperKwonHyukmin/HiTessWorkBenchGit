"""실행별 입력/출력 사본과 해시를 보관한다. 재실행 산출물 덮어쓰기와 분리한다."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import shutil


def archive_lifting_review(folder, job_id, artifacts, parameters):
    # job ID를 경로로 해석하지 않는다. 같은 실행을 다시 보관해도 기존 기록은 덮어쓰지 않는다.
    safe_id = hashlib.sha256(str(job_id).encode()).hexdigest()[:24]
    destination = Path(folder) / 'lifting_reviews' / safe_id
    destination.mkdir(parents=True, exist_ok=False)
    entries = {}
    try:
        for index, (key, source) in enumerate(artifacts.items()):
            if not source or not Path(source).is_file():
                entries[key] = {'available': False}
                continue
            original = Path(source)
            target = destination / f'{index:02d}_{original.name}'
            shutil.copyfile(original, target)
            with target.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            entries[key] = {'available': True, 'source': str(original), 'file': target.name,
                            'sha256': digest, 'size': target.stat().st_size}
        manifest = {'schema': 'side-passage-lifting-execution/1', 'jobId': job_id,
                    'createdAt': datetime.now(timezone.utc).isoformat(),
                    'parameters': parameters, 'artifacts': entries,
                    'scope': '실행 산출물 보관. 설계 승인 또는 선급 적합 인증이 아님.'}
        path = destination / 'manifest.json'
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
        return str(path)
    except Exception:
        # 부분 기록은 삭제하지 않고 미완료로 남겨 조사할 수 있게 한다.
        (destination / 'INCOMPLETE.txt').write_text('Archive incomplete; do not use as a complete execution record.', encoding='utf-8')
        raise
