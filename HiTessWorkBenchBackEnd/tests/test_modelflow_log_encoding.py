import pytest
from app.services import hitess_modelflow_service as service


@pytest.mark.parametrize('encoding', ['utf-8', 'cp949'])
def test_engine_output_preserves_korean_and_output_path(tmp_path, encoding):
    message = f'출력 폴더: {tmp_path}\n입력 감사: 00_InputAudit.json\nΔelem=-30'
    decoded = service._decode_engine_output(message.encode(encoding))
    assert decoded == message
    assert service._parse_output_dir(decoded) == str(tmp_path)


def test_utf8_bom_is_removed_before_output_path_detection(tmp_path):
    message = f'출력 폴더: {tmp_path}'
    decoded = service._decode_engine_output(message.encode('utf-8-sig'))
    assert service._parse_output_dir(decoded) == str(tmp_path)
