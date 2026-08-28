import test from 'node:test';
import assert from 'node:assert/strict';

import { isDoublePipeProject, normalizeDoublePipeProject } from './doublePipeProject.js';

test('recognizes the DoublePipe program alias', () => {
  assert.equal(isDoublePipeProject({ program_name: 'DoublePipeFuelLine' }), true);
  assert.equal(isDoublePipeProject({ program_name: '이중관 구조 연료배관 해석' }), true);
  assert.equal(isDoublePipeProject({ program_name: 'Truss Assessment' }), false);
});

test('normalizes persisted DoublePipe inputs and results for My Projects details', () => {
  const project = {
    program_name: 'DoublePipeFuelLine',
    status: 'Success',
    input_info: {
      input_csv: 'C:\\jobs\\pipe.csv',
      input_mode: 'inner_support',
      load_case_mode: 'selected',
      load_cases: ['L17', 'L18'],
      inner_support_config: {
        inner_pipe: { outDia: 88.9, thick: 5.49 },
        ubolt: { support_stiffness: 12000000 },
        load_conditions: { temperature: 80, pressure: 2.5 },
      },
    },
    result_info: {
      report: 'C:\\jobs\\Report for PSA.xlsx',
      report_ready: true,
      started_at: '2026-08-28T10:15:00',
      finished_at: '2026-08-28T10:25:00',
      duration_sec: 600,
      returncode: 0,
      logs: ['solver queued', 'report complete'],
    },
  };

  const detail = normalizeDoublePipeProject(project);

  assert.equal(detail.inputModeLabel, 'Inner Support 설계 결과');
  assert.equal(detail.loadCaseLabel, '선택 2개 (L17, L18)');
  assert.equal(detail.inputCsv, 'C:\\jobs\\pipe.csv');
  assert.equal(detail.reportPath, 'C:\\jobs\\Report for PSA.xlsx');
  assert.equal(detail.durationLabel, '10분 00초');
  assert.deepEqual(detail.config.inner_pipe, { outDia: 88.9, thick: 5.49 });
  assert.deepEqual(detail.logs, ['solver queued', 'report complete']);
});

test('keeps legacy DoublePipe records readable', () => {
  const detail = normalizeDoublePipeProject({
    program_name: 'DoublePipeFuelLine',
    input_info: { input_csv: 'pipe.csv', load_cases: 'ALL(29)' },
    result_info: { work_dir: 'C:\\jobs\\legacy' },
  });

  assert.equal(detail.loadCaseLabel, '전체 29개');
  assert.equal(detail.inputModeLabel, '배관 CSV 직접 입력');
  assert.deepEqual(detail.logs, []);
});

test('normalizes a Tab 1-only Inner Support project without calling it an Abaqus result', () => {
  const detail = normalizeDoublePipeProject({
    program_name: 'DoublePipeFuelLine',
    status: 'Success',
    input_info: {
      workflow_step: 'inner_support',
      input_csv: 'C:\\jobs\\outer.csv',
      input_mode: 'inner_support',
      inner_support_config: { inner_pipe: { outDia: 88.9 } },
    },
    result_info: {
      workflow_step: 'inner_support',
      result_csv: 'C:\\jobs\\outer_Y-15000.csv',
      row_count: 42,
      duration_sec: 3,
      logs: ['transform complete'],
    },
  });

  assert.equal(detail.isInnerSupportOnly, true);
  assert.equal(detail.workflowStepLabel, 'Tab 1 · Inner Support 설계');
  assert.equal(detail.resultSectionLabel, 'Inner Support 설계 결과');
  assert.equal(detail.loadCaseLabel, '해당 없음 (Tab 1)');
  assert.equal(detail.outputCsv, 'C:\\jobs\\outer_Y-15000.csv');
  assert.equal(detail.rowCount, 42);
  assert.equal(detail.logSectionLabel, '변환 로그');
});
