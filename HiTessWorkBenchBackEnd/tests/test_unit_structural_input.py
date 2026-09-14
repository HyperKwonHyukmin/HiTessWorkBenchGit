import pytest


@pytest.mark.parametrize('field', ['safety_factor', 'allowable_mpa'])
@pytest.mark.parametrize('value', ['nan', 'inf', '-inf', '0', '-1'])
def test_invalid_engine_parameters_rejected_before_parent_lookup(switchable_client, field, value):
    switchable_client.as_user()
    response = switchable_client.post('/api/analysis/unit-structural/request', data={
        'employee_id': 'EMP001', 'parent_analysis_id': 999999,
        'stability_path': 'unused.json', field: value,
    })
    assert response.status_code == 400, response.text
    assert field in response.json()['detail']
