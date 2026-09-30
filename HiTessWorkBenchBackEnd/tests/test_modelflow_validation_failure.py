import json
import pytest
from types import SimpleNamespace
from unittest.mock import patch

from app.services import hitess_modelflow_service as service


@pytest.mark.parametrize('exit_code', [1, 2])
def test_failed_validation_preserves_review_artifacts(tmp_path, exit_code):
    output = tmp_path / '20260930_114530'
    output.mkdir()
    (output / '00_InputAudit.json').write_text('{}', encoding='utf-8')
    (output / '00_StageSummary.json').write_text('{}', encoding='utf-8')
    (output / '06_Validation.json').write_text(json.dumps({'diagnostics': [
        {'severity': 'error', 'code': 'EMPTY_RIGID', 'elemId': 1022, 'nodeId': 1293}
    ]}), encoding='utf-8')
    result = SimpleNamespace(returncode=exit_code, stdout=f'출력 폴더: {output}\n[Error] EMPTY_RIGID', stderr='')
    executable = tmp_path / 'engine.exe'
    executable.touch()
    with patch.object(service, 'mark_running'), patch.object(service, 'update_progress'), \
            patch.object(service, 'is_cancel_requested', return_value=False), \
            patch.object(service.subprocess, 'run', return_value=result), \
            patch.object(service, 'record_analysis', return_value=(None, None)) as record, \
            patch.object(service, 'mark_complete') as complete:
        service.task_execute_modelflow('job', 'stru.csv', None, None, str(tmp_path),
                                      str(executable), 'tester', 'timestamp', 'test')
    assert complete.call_args.args[1] == 'Failed'
    extra = complete.call_args.kwargs['extra']
    assert extra['output_dir'] == str(output)
    assert extra['summary_path'] == str(output / '00_StageSummary.json')
    assert extra['audit_path'] == str(output / '00_InputAudit.json')
    assert extra['bdf_path'] is None
    assert 'EMPTY_RIGID' in complete.call_args.kwargs['failure_message']
    assert 'N1293' in complete.call_args.kwargs['failure_message']
    assert record.call_args.kwargs['result_info']['summary_path'] == extra['summary_path']
