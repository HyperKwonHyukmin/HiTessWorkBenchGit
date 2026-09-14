import hashlib
import json
import pytest
from app.services.lifting_review_archive import archive_lifting_review


def test_archive_preserves_original_after_rerun(tmp_path):
    source = tmp_path / 'model.bdf'
    source.write_text('original')
    path = archive_lifting_review(tmp_path, '../job', {'bdf': source, 'absent': None}, {'safetyFactor': 1})
    manifest = json.loads(open(path, encoding='utf-8').read())
    from pathlib import Path
    stored = Path(path).parent / manifest['artifacts']['bdf']['file']
    source.write_text('rerun')
    assert stored.read_text() == 'original'
    assert manifest['artifacts']['bdf']['sha256'] == hashlib.sha256(b'original').hexdigest()
    assert manifest['artifacts']['absent'] == {'available': False}
    assert stored.is_relative_to(tmp_path / 'lifting_reviews')
    with pytest.raises(FileExistsError):
        archive_lifting_review(tmp_path, '../job', {'bdf': source}, {})


def test_distinct_runs_keep_distinct_inputs(tmp_path):
    a = archive_lifting_review(tmp_path, 'a', {}, {'safetyFactor': 1})
    b = archive_lifting_review(tmp_path, 'b', {}, {'safetyFactor': 2})
    assert a != b
    assert json.loads(open(a, encoding='utf-8').read())['parameters']['safetyFactor'] == 1
