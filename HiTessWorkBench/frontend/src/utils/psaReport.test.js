import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMP_RM, createDefaultInput, nextTdLineNo, addLine, addCompRmLine, moveLine, removeLine,
  manifoldRowsUsingLine, removePosition, loadsUsingPosition, manifoldLoadsFor, manifoldSizeLabel,
  MANIFOLD_SIZES, isRealOrBlank, stepSummary, serializeInput, parseInputFile, summarizePickedFolder,
  duplicateLineNos,
  lineCheckState, checklistBusy
} from './psaReport.js';

test('기본 입력 = Line 7개, COMP.RM 이 끝, Process 기본값, Manifold TD01·TD02 400A', () => {
  const s = createDefaultInput();
  assert.deepEqual(s.lines.map(l => l.lineNo), ['TD01', 'TD02', 'TD03', 'TD04', 'TD05', 'TD06', COMP_RM]);
  const td06 = s.lines[5];
  assert.deepEqual(s.process[td06.uid].pressure, { a: '0.35', b: '', join: '' });
  assert.deepEqual(s.process[s.lines[0].uid].minTemp, { a: '-163', b: '-196', join: 'alt' });
  // 줄마다 다른 객체(한 줄을 고쳐도 다른 줄이 바뀌지 않게)
  assert.notEqual(s.process[s.lines[2].uid].density, s.process[s.lines[3].uid].density);
  assert.equal(s.manifold.length, 2);
  assert.equal(s.manifold[0].lineUid, s.lines[0].uid);
  assert.equal(s.manifold[1].size, '400');
  assert.equal(s.accelLoads[2].positionUid, s.accelPositions[1].uid);
});

test('새 Line 번호 = 가장 큰 TD + 1, COMP.RM 바로 위에 들어감, Process 는 빈 줄', () => {
  let s = createDefaultInput();
  s = addLine(s);
  assert.deepEqual(s.lines.slice(-2).map(l => l.lineNo), ['TD07', COMP_RM]);
  assert.deepEqual(s.process[s.lines[6].uid].pressure, { a: '', b: '', join: '' });
  // 순서를 바꿔도 번호는 그대로, 다음 번호는 최대값 기준
  s = moveLine(s, s.lines[6].uid, -6);
  assert.equal(s.lines[0].lineNo, 'TD07');
  assert.equal(nextTdLineNo(s.lines), 'TD08');
  assert.equal(nextTdLineNo([{ lineNo: COMP_RM }]), 'TD01');
});

test('COMP.RM 이 없으면 끝에 추가, 있으면 그대로', () => {
  let s = createDefaultInput();
  const before = s.lines.length;
  assert.equal(addCompRmLine(s), s);
  s = removeLine(s, s.lines.at(-1).uid);
  s = addLine(s); // COMP.RM 이 없으면 끝에 추가
  assert.equal(s.lines.at(-1).lineNo, 'TD07');
  s = addCompRmLine(s);
  assert.equal(s.lines.length, before + 1);
  assert.equal(s.process[s.lines.at(-1).uid].fluid, 'LNG & NG');
});

test('moveLine 은 양 끝을 넘지 않는다', () => {
  const s = createDefaultInput();
  assert.equal(moveLine(s, s.lines[0].uid, -1), s);
  assert.equal(moveLine(s, s.lines.at(-1).uid, 1), s);
});

test('Line 삭제는 Process 줄과 그 Line 의 Manifold 줄도 지운다', () => {
  const s = createDefaultInput();
  const td01 = s.lines[0].uid;
  assert.equal(manifoldRowsUsingLine(s, td01), 1);
  const after = removeLine(s, td01);
  assert.equal(after.lines.length, 6);
  assert.equal(after.process[td01], undefined);
  assert.equal(after.manifold.length, 1);
});

test('Position 삭제는 Load 줄을 남기고 Discipline 만 비운다', () => {
  const s = createDefaultInput();
  const trunk = s.accelPositions[0].uid;
  assert.equal(loadsUsingPosition(s, trunk), 2);
  const after = removePosition(s, trunk);
  assert.equal(after.accelLoads.length, 3);
  assert.equal(after.accelLoads.filter(a => a.positionUid === '').length, 2);
});

test('Manifold 표준값과 Mx·Mz = Mxz/√2', () => {
  assert.equal(MANIFOLD_SIZES.length, 7);
  const m100 = manifoldLoadsFor('100');
  assert.equal(m100.mx, 6576.1);
  assert.equal(manifoldLoadsFor('150').mz, 17677.7);
  assert.equal(manifoldLoadsFor('500').mx, 141421.4);
  assert.equal(manifoldLoadsFor('400').fy, 100000);
  assert.equal(manifoldLoadsFor('300/350').my, 4000);
  assert.equal(manifoldLoadsFor('999'), null);
  assert.equal(manifoldSizeLabel('400'), '400A');
});

test('실수 칸 검사: 빈 칸과 음수, 지수 표기는 통과, 글자는 실패', () => {
  for (const ok of ['', '  ', '1', '-0.5', '+3.', '.25', '1e-3']) assert.equal(isRealOrBlank(ok), true, ok);
  for (const bad of ['abc', '1,000', '1.2.3', '--1']) assert.equal(isRealOrBlank(bad), false, bad);
});

test('빈 칸 세기: 기본 입력', () => {
  const s = createDefaultInput();
  const sum = stepSummary(s);
  assert.equal(sum.scope.empty, 0);
  assert.equal(sum.scope.noFolder, 7);
  assert.equal(sum.process.empty, 0);
  assert.equal(sum.displacement.empty, 0);
  assert.equal(sum.accel.empty, 0);
  assert.equal(sum.manifold.empty, 0);
});

test('빈 칸 세기: 숫자 아님, 중복 Line No., 지워진 Line 을 가리키는 Manifold', () => {
  let s = createDefaultInput();
  s = { ...s, displacement: { ...s.displacement, sun: 'x', cold: '0.2' } };
  s = { ...s, lines: s.lines.map((l, i) => (i === 1 ? { ...l, lineNo: 'td01' } : l)) };
  s = { ...s, manifold: [...s.manifold, { uid: 'm', lineUid: 'gone', size: '' }] };
  const sum = stepSummary(s);
  assert.equal(sum.displacement.invalid, 1);
  assert.equal(sum.displacement.empty, 0);
  assert.equal(sum.scope.invalid, 2);
  assert.deepEqual([...duplicateLineNos(s.lines)], ['TD01']);
  assert.equal(sum.manifold.empty, 2);
});

test('입력 파일 저장 후 불러오기: 값은 그대로, 폴더는 다시 선택 필요', () => {
  let s = createDefaultInput();
  s.lines[0] = { ...s.lines[0], folder: { name: 'TD01_result', fileCount: 12, totalBytes: 100 } };
  s.displacement.tdSeaHog = '-0.35';
  const back = parseInputFile(serializeInput(s));
  assert.deepEqual(back.lines.map(l => l.lineNo), s.lines.map(l => l.lineNo));
  assert.deepEqual(back.process[back.lines[5].uid].pressure, { a: '0.35', b: '', join: '' });
  assert.deepEqual(back.process[back.lines[6].uid].density, { a: '500', b: '25', join: 'and' });
  assert.equal(back.displacement.tdSeaHog, '-0.35');
  assert.deepEqual(back.lines[0].folder, { name: 'TD01_result', fileCount: 12, totalBytes: 100, stale: true });
  assert.equal(back.lines[1].folder, null);
  assert.equal(back.manifold[0].lineUid, back.lines[0].uid);
  assert.equal(back.accelLoads[0].positionUid, back.accelPositions[0].uid);
});

test('입력 파일 오류 문구: DRM, JSON 아님, 다른 파일', () => {
  assert.throws(() => parseInputFile('HHIDRMC....'), /DRM/);
  assert.throws(() => parseInputFile('{oops'), /JSON 형식/);
  assert.throws(() => parseInputFile('{"a":1}'), /PSA 입력 파일이 아닙니다/);
});

test('폴더 선택 요약', () => {
  assert.equal(summarizePickedFolder([]), null);
  const sum = summarizePickedFolder([
    { name: 'a.f06', webkitRelativePath: 'TD01_result/a.f06', size: 10 },
    { name: 'b.png', webkitRelativePath: 'TD01_result/fig/b.png', size: 5 },
  ]);
  assert.deepEqual(sum, { name: 'TD01_result', fileCount: 2, totalBytes: 15 });
});

import {
  serverFolderName, relativeInsidePicked, planBatches, reconcileFolders, folderReady, WORKSPACE_RE,
} from './psaReport.js';

test('서버 폴더 이름: Line No. 를 그대로, 못 쓰는 이름은 null', () => {
  assert.equal(serverFolderName('TD01'), 'TD01');
  assert.equal(serverFolderName(' COMP.RM '), 'COMP.RM');
  for (const bad of ['', '..', 'a/b', 'TD01.', 'nul', 'Figures', 'x'.repeat(41), '가나']) {
    assert.equal(serverFolderName(bad), null, bad);
  }
});

test('고른 폴더 안 상대 경로', () => {
  assert.equal(relativeInsidePicked({ webkitRelativePath: 'Top/a/b.f06' }), 'a/b.f06');
  assert.equal(relativeInsidePicked({ name: 'x.txt' }), 'x.txt');
});

test('업로드 묶음: 파일 수와 크기 상한, 큰 파일은 혼자', () => {
  const f = (size) => ({ size });
  assert.deepEqual(planBatches([f(1), f(1), f(1)], { maxFiles: 2 }).map(b => b.length), [2, 1]);
  assert.deepEqual(planBatches([f(60), f(60), f(200), f(10)], { maxBytes: 100 }).map(b => b.length), [1, 1, 1, 1]);
  assert.deepEqual(planBatches([]), []);
});

test('서버 상태 맞추기: 남은 폴더는 확인 완료, 없는 폴더와 사라진 작업 폴더는 다시 선택', () => {
  let s = createDefaultInput();
  s = { ...s, workspace: '20261117_100000_A476854_PsaReport' };
  s.lines[0] = { ...s.lines[0], folder: { name: 'r1', fileCount: 3, totalBytes: 1, target: 'TD01', stale: true } };
  s.lines[1] = { ...s.lines[1], folder: { name: 'r2', fileCount: 2, totalBytes: 1, target: 'TD02', stale: true } };
  const ok = reconcileFolders(s, { TD01: { fileCount: 5, totalBytes: 9 } });
  assert.equal(folderReady(ok.lines[0].folder), true);
  assert.equal(ok.lines[0].folder.fileCount, 5);
  assert.equal(ok.lines[1].folder.stale, true);
  const gone = reconcileFolders(s, null);
  assert.equal(gone.workspace, null);
  assert.equal(gone.lines[0].folder.stale, true);
  assert.equal(stepSummary(ok).scope.noFolder, 6);
});

test('작업 폴더 이름은 저장 후 불러와도 남고, 모양이 틀리면 버린다', () => {
  const s = { ...createDefaultInput(), workspace: '20261117_100000_A476854_PsaReport' };
  assert.equal(parseInputFile(serializeInput(s)).workspace, s.workspace);
  assert.equal(parseInputFile(serializeInput({ ...s, workspace: '../x' })).workspace, null);
  assert.ok(WORKSPACE_RE.test(s.workspace));
});

test('서버 파일 수가 고른 파일 수보다 적으면 올리다 끊긴 것', () => {
  let s = { ...createDefaultInput(), workspace: '20261117_100000_A476854_PsaReport' };
  s.lines[0] = { ...s.lines[0], folder: { name: 'r1', fileCount: 10, totalBytes: 1, target: 'TD01', stale: true } };
  const r = reconcileFolders(s, { TD01: { fileCount: 4, totalBytes: 1 } });
  assert.equal(r.lines[0].folder.incomplete, true);
  assert.equal(folderReady(r.lines[0].folder), false);
});

import { formatValueCell, formatProcessRow, readValueCell } from './psaReport.js';

test('보고서 표기: 숫자마다 단위, 범위와 둘 다와 보조 값', () => {
  assert.equal(formatValueCell({ a: '-163', b: '', join: '' }, '°C'), '-163°C');
  assert.equal(formatValueCell({ a: '-196', b: '-18', join: 'range' }, '°C'), '-196°C ~ -18°C');
  assert.equal(formatValueCell({ a: '0.87', b: '15', join: 'range' }, 'barg'), '0.87barg ~ 15barg');
  assert.equal(formatValueCell({ a: '500', b: '25', join: 'and' }, 'kg/m³'), '500 kg/m³ & 25 kg/m³');
  assert.equal(formatValueCell({ a: '80', b: '45', join: 'alt' }, '°C'), '80°C\n45°C(*)');
  assert.equal(formatValueCell({ a: '80', b: '', join: 'alt' }, '°C'), '80°C');
  assert.equal(formatValueCell({ a: '', b: '', join: '' }, '°C'), '');
  const s = createDefaultInput();
  assert.deepEqual(formatProcessRow(s.process[s.lines[1].uid]), {
    minTemp: '-163°C', maxTemp: '45°C', pressure: '10barg', fluid: 'NG', density: '25 kg/m³', insulation: 'A',
  });
});

test('1판 글자 값도 숫자 구조로 옮긴다', () => {
  assert.deepEqual(readValueCell('-163°C\n-196°C(*)'), { a: '-163', b: '-196', join: 'alt' });
  assert.deepEqual(readValueCell('0.87barg\n~15barg'), { a: '0.87', b: '15', join: 'range' });
  assert.deepEqual(readValueCell('500 kg/m³\n& 25 kg/m³'), { a: '500', b: '25', join: 'and' });
  assert.deepEqual(readValueCell('10barg'), { a: '10', b: '', join: '' });
  assert.deepEqual(readValueCell({ a: '1', b: '2', join: 'bogus' }), { a: '1', b: '', join: '' });
});

test('Process 빈 칸과 숫자 아님: 둘째 값은 잇는 방식이 있을 때만 센다', () => {
  let s = createDefaultInput();
  const uid = s.lines[1].uid;
  s = { ...s, process: { ...s.process, [uid]: { ...s.process[uid], pressure: { a: 'x', b: '', join: '' }, minTemp: { a: '1', b: '', join: 'range' }, fluid: '' } } };
  const sum = stepSummary(s);
  assert.equal(sum.process.invalid, 1);
  assert.equal(sum.process.empty, 2);
});

test('입력 파일에 보고서 표기가 함께 실린다', () => {
  const saved = JSON.parse(serializeInput(createDefaultInput()));
  assert.equal(saved.version, 6);
  assert.equal(saved.report.process[6].minTemp, '-196°C ~ -18°C');
  assert.equal(saved.report.process[0].lineNo, 'TD01');
});

import { DEFAULT_PROCESS_NOTES } from './psaReport.js';

test('Process 표 설명 기본 문단: 새 입력에 들어가고, 2판 이하에서 비어 있으면 채우며, 3판에서 비운 것은 그대로', () => {
  const s = createDefaultInput();
  assert.equal(s.processNotes, DEFAULT_PROCESS_NOTES);
  assert.match(DEFAULT_PROCESS_NOTES, /ambient temperature considered for this calculation is 21℃/);
  const v2 = JSON.parse(serializeInput(s));
  v2.version = 2; v2.processNotes = '';
  assert.equal(parseInputFile(JSON.stringify(v2)).processNotes, DEFAULT_PROCESS_NOTES);
  const v3 = JSON.parse(serializeInput({ ...s, processNotes: '' }));
  assert.equal(parseInputFile(JSON.stringify(v3)).processNotes, '');
});

import { lineFromExcelName, planExcelFiles, applyExcelPlan, uniqueServerFolder, isTempFile, isExcelFile, baseLineNo } from './psaReport.js';

const xf = (name, size = 1) => ({ name, size });

test('엑셀 파일 이름 → Line (TD-06_1 은 따로인 Line TD06-1)', () => {
  assert.deepEqual(lineFromExcelName('TD-01.xlsx'), { lineNo: 'TD01', pipeLine: 'Liquid Main' });
  assert.deepEqual(lineFromExcelName('TD-01 LIQUID.xlsx'), { lineNo: 'TD01', pipeLine: 'LIQUID' });
  assert.deepEqual(lineFromExcelName('TD-06_1.xlsx'), { lineNo: 'TD06-1', pipeLine: 'Tank Vent No.1' });
  assert.deepEqual(lineFromExcelName('TD-06-3.xlsx'), { lineNo: 'TD06-3', pipeLine: 'Tank Vent No.3' });
  assert.equal(lineFromExcelName('td_7.xlsx').lineNo, 'TD07');
  assert.equal(lineFromExcelName('TD-01 2025.xlsx').lineNo, 'TD01'); // 네 자리 숫자는 모델 번호가 아님
  assert.equal(lineFromExcelName('TD-01_R2.xlsx').lineNo, 'TD01');
  assert.equal(lineFromExcelName('Compressor Room.xlsx').lineNo, 'COMP.RM');
  assert.equal(lineFromExcelName('COMP RM.xlsx').lineNo, 'COMP.RM');
  for (const n of ['BELLOWS.xlsx', 'TDX.xlsx', 'Report.xlsx']) assert.equal(lineFromExcelName(n), null, n);
  assert.equal(baseLineNo('TD06-2'), 'TD06');
  assert.equal(baseLineNo('TD01'), 'TD01');
});

test('임시 파일과 엑셀 아닌 파일은 거른다', () => {
  assert.equal(isTempFile('Top/~$441s report.docx'), true);
  assert.equal(isTempFile('Top/TD-03 Spray/OP2139E.tmp'), true);
  assert.equal(isTempFile('Top/TD-03 Spray/3441.C2'), false);
  assert.equal(isExcelFile('TD-01.xlsx'), true);
  assert.equal(isExcelFile('~$TD-01.xlsx'), false);
  assert.equal(isExcelFile('TD-01.pdf'), false);
});

test('엑셀 여러 개 → 엑셀마다 Line, 번호 순 자리, 기본값은 원래 번호 기준', () => {
  const files = ['TD-06_2.xlsx', 'TD-01.xlsx', 'TD-06_1.xlsx', 'TD-02.xlsx', 'Bellows 해석.xlsx', 'TD-06_10.xlsx', 'memo.txt'].map(n => xf(n));
  const plan = planExcelFiles([], files);
  assert.deepEqual(plan.assign.map(a => a.lineNo), ['Bellows _', 'TD01', 'TD02', 'TD06-1', 'TD06-2', 'TD06-10']);
  assert.deepEqual(plan.skipped, ['memo.txt']);
  const { input, uidByNo } = applyExcelPlan(createBlankInput(), plan);
  assert.deepEqual(input.lines.map(l => l.lineNo), ['TD01', 'TD02', 'TD06-1', 'TD06-2', 'TD06-10', 'Bellows _']);
  assert.ok(input.lines.every(l => l.modelCount === 1));
  // TD06-1 은 TD06 의 Process 기본값, 이름 모르는 줄은 빈 값
  assert.deepEqual(input.process[uidByNo['TD06-1']].pressure, { a: '0.35', b: '', join: '' });
  assert.deepEqual(input.process[uidByNo['BELLOWS _']].pressure, { a: '', b: '', join: '' });
  assert.deepEqual(input.manifold.map(m => [m.lineUid, m.size]), [[uidByNo.TD01, '400'], [uidByNo.TD02, '400']]);
});

test('같은 Line No. 가 있으면 그 줄의 엑셀을 바꾸고, 한 번에 같은 번호가 둘이면 뒤 파일에 (2)', () => {
  const s0 = applyExcelPlan(createBlankInput(), planExcelFiles([], [xf('TD-01.xlsx')])).input;
  const plan = planExcelFiles(s0.lines, [xf('TD01 new.xlsx'), xf('TD-02.xlsx'), xf('TD-02 copy.xlsx')]);
  assert.equal(plan.assign.find(a => a.lineNo === 'TD01').lineUid, s0.lines[0].uid);
  assert.deepEqual(plan.assign.map(a => a.lineNo).sort(), ['TD01', 'TD02', 'TD02 (2)']);
  assert.deepEqual(plan.assign.filter(a => a.lineNo.startsWith('TD02')).map(a => a.file.name).sort(), ['TD-02 copy.xlsx', 'TD-02.xlsx']);
  const { input } = applyExcelPlan(s0, plan);
  assert.equal(input.lines.length, 3);
});

test('서버 폴더 이름은 다른 줄과 겹치지 않게', () => {
  const lines = [{ uid: 'a', lineNo: 'X', folder: { target: 'TD01' } }, { uid: 'b', lineNo: 'TD01', folder: null }];
  assert.equal(uniqueServerFolder(lines, 'b', 'TD01'), 'TD01 (2)');
  assert.equal(uniqueServerFolder(lines, 'a', 'TD01'), 'TD01');
  assert.equal(uniqueServerFolder(lines, 'b', '한글'), null);
});

test('Others, Figures 는 Line 폴더 이름으로 못 쓴다', () => {
  assert.equal(serverFolderName('Others'), null);
  assert.equal(serverFolderName('figures'), null);
});

import { DEFAULT_DISPLACEMENT } from './psaReport.js';

test('Displacement, Acceleration 기본값 = 보고서 Table 2.4~2.6', () => {
  const s = createDefaultInput();
  assert.deepEqual(s.displacement, DEFAULT_DISPLACEMENT);
  assert.equal(s.displacement.tdTermSag, '-0.50');
  assert.deepEqual(s.accelPositions.map(p => [p.discipline, p.x, p.y, p.z]), [
    ['Trunk Deck', '57000', '8190', '37800'], ['Cargo Compressor Room', '77150', '3200', '44000'],
  ]);
  assert.deepEqual(s.accelLoads.map(a => [a.x, a.y, a.z]), [
    ['0.31', '1.255', '0.579'], ['0.155', '0.6275', '0.2895'], ['0.345', '1.391', '0.429'],
  ]);
  assert.equal(s.accelLoads[2].positionUid, s.accelPositions[1].uid);
});

test('3판 이하 입력: 비어 있던 변위와 가속도는 기본값으로, 하나라도 적었으면 그대로', () => {
  const s = createDefaultInput();
  const old = JSON.parse(serializeInput(s));
  old.version = 3;
  Object.keys(old.displacement).forEach(k => { old.displacement[k] = ''; });
  old.accelPositions.forEach(p => { p.x = ''; p.y = ''; p.z = ''; });
  old.accelLoads.forEach(a => { a.x = ''; a.y = ''; a.z = ''; });
  const back = parseInputFile(JSON.stringify(old));
  assert.deepEqual(back.displacement, DEFAULT_DISPLACEMENT);
  assert.equal(back.accelPositions[1].x, '77150');
  assert.equal(back.accelLoads[2].positionUid, back.accelPositions[1].uid);

  old.displacement.sun = '0.1';
  old.accelLoads[0].x = '9';
  const kept = parseInputFile(JSON.stringify(old));
  assert.equal(kept.displacement.sun, '0.1');
  assert.equal(kept.displacement.cold, '');
  assert.equal(kept.accelLoads[0].x, '9');
});

import {
  CHECKLIST_KINDS, lineChecklist, checklistSummary, applyChecklistSelections, chooseChecklistFile, autoPick, modelLabel,
} from './psaReport.js';

const scanOf = (kinds) => ({ kinds: { restraint: [], codeCompliance: [], iso: [], inputEcho: [], nozzleCompressor: [], nozzleHeatExchanger: [], ...kinds }, unreadable: [] });
const ready = (l, target) => ({ ...l, folder: { name: target, fileCount: 1, totalBytes: 1, target } });

test('체크리스트 항목: 엑셀의 Restraint 와 응력 요약 두 가지(COMP.RM 도 같음)', () => {
  const s = createDefaultInput();
  assert.equal(CHECKLIST_KINDS.length, 2);
  assert.equal(lineChecklist(s.lines[0], scanOf({})).length, 2);
  assert.equal(lineChecklist(s.lines.at(-1), scanOf({})).length, 2);
  // 예전 입력의 TD06(모델 4개)은 2가지 x 4
  assert.equal(s.lines[5].modelCount, 4);
  assert.equal(lineChecklist(s.lines[5], scanOf({})).length, 8);
  assert.equal(modelLabel(s.lines[5], 2), 'TD06-3');
});

test('자동 선택: 후보 하나면 그것, 여럿이면 고르기, 모델이 여럿이면 경로의 NO.k', () => {
  assert.equal(autoPick(['a.xlsx'], 0, 1), 'a.xlsx');
  assert.equal(autoPick(['a.xlsx', 'b.xlsx'], 0, 1), null);
  const c = ['NO.1/R.xlsx', 'NO.2/R.xlsx', 'NO.3/R.xlsx', 'NO.4 ISO/R.xlsx', '선주 PCF/TD06_1 R.xlsx'];
  assert.equal(autoPick(c, 0, 4), 'NO.1/R.xlsx');
  assert.equal(autoPick(c, 3, 4), 'NO.4 ISO/R.xlsx');
  assert.equal(autoPick(['No.10/R.xlsx', 'NO.1/R.xlsx'], 0, 4), 'NO.1/R.xlsx');
});

test('요약: 빠진 것, 고를 것, 폴더 없는 Line 이 있으면 실행 불가', () => {
  let s = createDefaultInput();
  s = { ...s, lines: [ready(s.lines[0], 'TD01')] };
  const full = { TD01: scanOf({ restraint: ['r.xlsx'], codeCompliance: ['c.xlsx'], iso: ['i.pdf'], inputEcho: ['e.pdf'] }) };
  assert.equal(checklistSummary(s, full).ready, true);
  assert.equal(checklistSummary(s, null).ready, false);

  const noCC = { TD01: scanOf({ restraint: ['r.xlsx'], iso: ['i.pdf'], inputEcho: ['e.pdf'] }) };
  const sum = checklistSummary(s, noCC);
  assert.equal(sum.ready, false);
  assert.deepEqual(sum.missing, [{ lineNo: 'TD01', label: 'Stress Summary' }]);

  const two = { TD01: scanOf({ restraint: ['r1.xlsx', 'r2.xlsx'], codeCompliance: ['c.xlsx'], iso: ['i.pdf'], inputEcho: ['e.pdf'] }) };
  assert.equal(checklistSummary(s, two).choose.length, 1);
  const picked = chooseChecklistFile(s, s.lines[0].uid, 'restraint', 0, 'r2.xlsx');
  assert.equal(checklistSummary(picked, two).ready, true);

  const noFolder = { ...s, lines: [{ ...s.lines[0], folder: null }] };
  assert.deepEqual(checklistSummary(noFolder, full).noFolder, ['TD01']);
});

test('자동 선택은 입력값에 적히고, 저장 후 불러와도 남는다', () => {
  let s = createDefaultInput();
  s = { ...s, lines: [ready(s.lines[0], 'TD01')] };
  const cl = { TD01: scanOf({ restraint: ['r.xlsx'], codeCompliance: ['c1.xlsx', 'c2.xlsx'], iso: ['i.pdf'], inputEcho: ['e.pdf'] }) };
  const next = applyChecklistSelections(s, cl);
  assert.deepEqual(next.lines[0].files, { restraint: ['r.xlsx'], codeCompliance: [''] });
  assert.equal(applyChecklistSelections(next, cl), next); // 바뀐 것 없으면 같은 객체
  const back = parseInputFile(serializeInput(next));
  assert.deepEqual(back.lines[0].files.restraint, ['r.xlsx']);
  assert.equal(back.lines[0].modelCount, 1);
  // 고른 파일이 폴더에서 사라지면 다시 자동 규칙으로
  const gone = { TD01: scanOf({ restraint: ['r9.xlsx'], codeCompliance: ['c1.xlsx'], iso: ['i.pdf'], inputEcho: ['e.pdf'] }) };
  assert.equal(lineChecklist(next.lines[0], gone.TD01)[0].selected, 'r9.xlsx');
});

test('예전 입력(모델 수 없음)의 TD06 은 모델 4개로 읽는다', () => {
  const raw = JSON.parse(serializeInput(createDefaultInput()));
  raw.lines.forEach(l => { delete l.modelCount; delete l.files; });
  const back = parseInputFile(JSON.stringify(raw));
  assert.equal(back.lines.find(l => l.lineNo === 'TD06').modelCount, 4);
  assert.equal(back.lines[0].modelCount, 1);
});

import { autoPickInfo, projectHullOf } from './psaReport.js';

test('후보가 여럿이면 가장 최근에 내보낸 파일을 자동으로, 같은 날이면 고르기', () => {
  const meta = {
    'a.xlsx': { exportedAt: '2026-06-16T17:42', job: 'J' },
    'b.xlsx': { exportedAt: '2026-06-17T09:57', job: 'J' },
    'c.xlsx': { exportedAt: '2025-06-04T16:37', job: 'J' },
  };
  assert.deepEqual(autoPickInfo(['a.xlsx', 'b.xlsx', 'c.xlsx'], 0, 1, meta), { path: 'b.xlsx', reason: 'newest' });
  assert.deepEqual(autoPickInfo(['a.xlsx', 'x.xlsx'], 0, 1, meta), { path: null, reason: null }); // 날짜 모르는 후보가 있으면 고르기
  assert.deepEqual(autoPickInfo(['a.xlsx', 'd.xlsx'], 0, 1, { ...meta, 'd.xlsx': { exportedAt: '2026-06-16T17:42', job: 'J' } }), { path: null, reason: null });
  // Job 이 섞여 있으면(다른 모델일 수 있음) 가장 최근이어도 고르지 않는다
  assert.deepEqual(autoPickInfo(['a.xlsx', 'e.xlsx'], 0, 1, { ...meta, 'e.xlsx': { exportedAt: '2027-01-01T00:00', job: 'CR08' } }), { path: null, reason: null });
  assert.deepEqual(autoPickInfo(['only.pdf'], 0, 1, {}), { path: 'only.pdf', reason: 'only' });
  // 모델이 여럿: NO.k 가 둘이면 그 안에서 최근 것
  const m2 = { 'NO.1/a.xlsx': { exportedAt: '2025-01-01T00:00', job: 'N1' }, 'NO.1/b.xlsx': { exportedAt: '2025-02-01T00:00', job: 'N1' } };
  assert.deepEqual(autoPickInfo(['NO.1/a.xlsx', 'NO.1/b.xlsx', 'NO.2/c.xlsx'], 0, 4, m2), { path: 'NO.1/b.xlsx', reason: 'newest' });
});

test('자동 선택 이유와 경고: 다른 호선 Job, Restraint 와 Code Compliance 의 Job 불일치', () => {
  let s = createDefaultInput();
  s = { ...s, lines: [ready(s.lines[0], 'TD01'), ready(s.lines[1], 'TD02')] };
  const cl = {
    TD01: { ...scanOf({ restraint: ['r1.xlsx', 'r2.xlsx'], codeCompliance: ['c.xlsx'], iso: ['i.pdf'], inputEcho: ['e.pdf'] }),
      meta: { 'r1.xlsx': { exportedAt: '2026-01-01T00:00', job: '3441-A', jobHull: '3441' }, 'r2.xlsx': { exportedAt: '2025-01-01T00:00', job: '3441-A', jobHull: '3341' }, 'c.xlsx': { exportedAt: '2026-01-02T00:00', job: '3441-B', jobHull: '3441' } } },
    TD02: { ...scanOf({ restraint: ['r.xlsx'], codeCompliance: ['c.xlsx'], iso: ['i.pdf'], inputEcho: ['e.pdf'] }),
      meta: { 'r.xlsx': { job: '3441-T2', jobHull: '3441' }, 'c.xlsx': { job: '3441-T2', jobHull: '3441' } } },
  };
  assert.equal(projectHullOf(s, cl), '3441');
  const rows = lineChecklist(s.lines[0], cl.TD01, '3441');
  const r = rows.find(x => x.kind === 'restraint');
  assert.equal(r.selected, 'r1.xlsx');
  assert.equal(r.reason, 'newest');
  assert.match(rows.find(x => x.kind === 'codeCompliance').warnings[0], /Restraint 와 Job 이 다름/);
  // 사용자가 다른 호선 파일을 고르면 이유 = chosen, 호선 경고
  const picked = chooseChecklistFile(s, s.lines[0].uid, 'restraint', 0, 'r2.xlsx');
  const r2 = lineChecklist(picked.lines[0], cl.TD01, '3441').find(x => x.kind === 'restraint');
  assert.equal(r2.reason, 'chosen');
  assert.match(r2.warnings[0], /Job 호선 3341/);
  // 경고는 실행을 막지 않는다
  const sum = checklistSummary(picked, cl);
  assert.equal(sum.ready, true);
  assert.ok(sum.warnings.length >= 1);
});

test('기준 호선은 최상단 폴더 이름이 먼저', () => {
  const s = { ...createDefaultInput(), sourceFolder: '3441 PSA REPORT - 연구소' };
  assert.equal(projectHullOf(s, {}), '3441');
  assert.equal(projectHullOf({ ...s, sourceFolder: 'H3441s PSA' }, {}), '3441');
  assert.equal(parseInputFile(serializeInput(s)).sourceFolder, '3441 PSA REPORT - 연구소');
});

import { createBlankInput, reportProblems } from './psaReport.js';

test('새로 열 때 = Piping line 없음, Manifold 없음, 나머지 기본값 그대로', () => {
  const s = createBlankInput();
  assert.equal(s.lines.length, 0);
  assert.deepEqual(s.process, {});
  assert.equal(s.manifold.length, 0);
  assert.equal(s.displacement.tdSeaHog, '0.81');
  assert.ok(s.accelPositions.length > 0);
});

test('줄 추가도 알려진 Line 번호면 Process 기본값', () => {
  const s = addLine(createBlankInput());
  assert.equal(s.lines[0].lineNo, 'TD01');
  assert.deepEqual(s.process[s.lines[0].uid].minTemp, { a: '-163', b: '-196', join: 'alt' });
});

test('보고서 만들기 검사: 막을 것과 승인 후 뺄 것을 나눔', () => {
  const blank = createBlankInput();
  assert.deepEqual(reportProblems(blank, checklistSummary(blank, null)).map(p => [p.step, p.level]), [['scope', 'block'], ['docinfo', 'skip']]);

  let s = createDefaultInput();
  s = { ...s, displacement: { ...s.displacement, sun: '', cold: 'abc' } };
  const probs = reportProblems(s, checklistSummary(s, null));
  assert.ok(probs.some(p => p.step === 'files' && p.level === 'skip' && p.text.startsWith('결과 엑셀이 없는 Line')));
  assert.ok(probs.some(p => p.step === 'displacement' && p.level === 'skip' && p.text.includes('빈 칸 1개')));
  assert.ok(probs.some(p => p.step === 'displacement' && p.level === 'block' && p.text.includes('숫자가 아닌 값 1칸')));
  assert.ok(!probs.some(p => p.step === 'process'));

  const fc = { ready: false, missing: [{ lineNo: 'TD01', label: 'Code Compliance' }], choose: [{ lineNo: 'TD03', label: 'Restraint Summary' }], noFolder: [], warnings: [] };
  const lv = reportProblems(createDefaultInput(), fc).filter(p => p.step === 'files').map(p => p.level);
  assert.deepEqual(lv, ['block', 'skip']);
});

test('고를 칸이 남으면 무엇을 해야 하는지와 펼칠 Line 을 알린다', () => {
  const fc = { ready: false, missing: [{ lineNo: 'TD01', label: 'Code Compliance', uid: 'L1' }],
    choose: [{ lineNo: 'TD03', label: 'Restraint Summary', uid: 'L3' }, { lineNo: 'TD05', label: 'Restraint Summary', uid: 'L5' }],
    noFolder: [], warnings: [] };
  const b = reportProblems(createDefaultInput(), fc).find(p => p.kind === 'choose');
  assert.equal(b.level, 'block');
  assert.equal(b.lineUid, 'L3'); // 빠진 파일(TD01)이 아니라 고를 칸이 있는 첫 Line
  assert.ok(b.text.startsWith('파일 후보가 여러 개인 칸 2개를 골라야 합니다'));
  assert.ok(b.text.includes('TD03 Restraint Summary'));
});

test('체크리스트 요약의 고를 칸은 Line uid 를 함께 준다', () => {
  let s = createDefaultInput();
  s = { ...s, lines: [{ ...s.lines[0], folder: { name: 'TD01', fileCount: 2, totalBytes: 1, target: 'TD01' } }] };
  const cl = { TD01: { kinds: { restraint: ['a.xlsx', 'b.xlsx'] }, meta: {}, unreadable: [] } };
  const fc = checklistSummary(s, cl);
  assert.equal(fc.choose.find(c => c.label === 'Restraint Summary')?.uid, s.lines[0].uid);
});

test('승인하고 뺀 자료 목록은 입력 JSON 에 남는다', () => {
  const s = { ...createDefaultInput(), reportExclusions: ['빠진 파일 1개: TD01 Code Compliance'] };
  assert.deepEqual(parseInputFile(serializeInput(s)).reportExclusions, ['빠진 파일 1개: TD01 Code Compliance']);
  assert.deepEqual(parseInputFile(serializeInput(createDefaultInput())).reportExclusions, []);
});

test('Line 파일 확인 상태: 올리는 중, 차례, 찾는 중을 없음과 구별한다', () => {
  const base = createDefaultInput().lines[0];
  const ready = { name: 'TD01', fileCount: 1, totalBytes: 1, target: 'TD01' };
  assert.equal(lineCheckState({ ...base, folder: { ...ready, uploading: true } }, null), 'uploading');
  assert.equal(lineCheckState({ ...base, folder: null }, null, { topBusy: true }), 'waiting');
  assert.equal(lineCheckState({ ...base, folder: null }, null), 'noFolder');
  assert.equal(lineCheckState({ ...base, folder: { ...ready, incomplete: true } }, null), 'noFolder');
  assert.equal(lineCheckState({ ...base, folder: ready }, {}, { pending: true }), 'checking'); // 올렸지만 아직 다시 확인 전
  assert.equal(lineCheckState({ ...base, folder: ready }, { TD01: { kinds: {} } }, { pending: true }), 'checking'); // 옛 결과는 믿지 않음
  assert.equal(lineCheckState({ ...base, folder: ready }, {}, { loading: true }), 'checking');
  assert.equal(lineCheckState({ ...base, folder: ready }, {}, { error: '서버 오류' }), 'error');
  assert.equal(lineCheckState({ ...base, folder: ready }, {}), 'lost'); // 확인 끝났는데 서버에 없음 → 찾는 중에 머물지 않음
  assert.equal(lineCheckState({ ...base, folder: ready }, { TD01: { kinds: {} } }), 'ready');
  const s = { ...createDefaultInput(), lines: [{ ...base, folder: ready }] };
  assert.equal(checklistBusy(s, {}, { pending: true }), true);
  assert.equal(checklistBusy(s, {}), false);
  assert.equal(checklistBusy(s, { TD01: { kinds: {} } }), false);
  assert.equal(checklistBusy(s, { TD01: { kinds: {} } }, { loading: true }), true);
});

import { defaultDocInfo, fillDocInfoFromFolder, docInfoSummary, DOC_INFO_FIELDS, lineMaterial, DEFAULT_MATERIAL } from './psaReport.js';

test('보고서 정보: 기본값, 최상단 폴더의 호선으로 채우기, 빈 칸 세기', () => {
  const s = createDefaultInput();
  assert.equal(s.docInfo.status, 'Preliminary');
  assert.equal(s.docInfo.title, '');
  const filled = fillDocInfoFromFolder({ ...s, sourceFolder: '3441 PSA REPORT - 연구소' });
  assert.equal(filled.docInfo.hullLabel, '3441');
  assert.equal(filled.docInfo.title, 'H3441 Design Basis of Pipe Stress Analysis for Cargo Systems');
  // 이미 적은 값은 건드리지 않는다
  const kept = fillDocInfoFromFolder({ ...s, sourceFolder: '3441 PSA', docInfo: { ...s.docInfo, hullLabel: '3441s' } });
  assert.equal(kept.docInfo.hullLabel, '3441s');
  assert.equal(fillDocInfoFromFolder({ ...s, sourceFolder: '호선 없음' }).docInfo.hullLabel, '');

  const sum = docInfoSummary(s);
  assert.ok(sum.labels.includes('Title') && sum.labels.includes('Client') && sum.labels.includes('개정 이력'));
  assert.ok(!sum.labels.includes('Status'));
  const all = { ...s, docInfo: Object.fromEntries(DOC_INFO_FIELDS.map(f => [f.key, 'x'])), revisions: [{ no: '0', date: 'd', contents: 'c' }] };
  assert.equal(docInfoSummary(all).empty, 0);
  assert.equal(docInfoSummary({ ...all, lines: [{ ...all.lines[0], material: '' }] }).labels[0], 'TD01 Material');
});

test('보고서 정보와 재질은 저장 파일에 남고 다시 읽힌다(옛 파일은 기본값)', () => {
  let s = createDefaultInput();
  s = { ...s, docInfo: { ...s.docInfo, client: 'OWNER' }, revisions: [{ uid: 'R1', no: '0', date: '2026.11.18', contents: 'First' }],
    lines: s.lines.map((l, i) => (i === 0 ? { ...l, material: 'A312 TP304', wallThickness: '' } : l)) };
  const raw = JSON.parse(serializeInput(s));
  assert.equal(raw.lines[0].material, 'A312 TP304');
  assert.equal(raw.lines[0].wallThickness, ''); // 일부러 비운 값은 기본값으로 덮지 않는다
  assert.equal(raw.lines[1].material, DEFAULT_MATERIAL); // 안 건드린 줄은 기본값을 적어 서버가 읽게
  const back = parseInputFile(serializeInput(s));
  assert.equal(back.docInfo.client, 'OWNER');
  assert.deepEqual(back.revisions.map(r => [r.no, r.contents]), [['0', 'First']]);
  assert.equal(lineMaterial(back.lines[0]), 'A312 TP304');

  const old = JSON.parse(serializeInput(s));
  delete old.docInfo; delete old.revisions; old.lines.forEach(l => { delete l.material; delete l.wallThickness; });
  const fromOld = parseInputFile(JSON.stringify(old));
  assert.equal(fromOld.docInfo.status, 'Preliminary');
  assert.equal(fromOld.docInfo.client, '');
  assert.equal(lineMaterial(fromOld.lines[0]), DEFAULT_MATERIAL);
});

test('보고서 만들기 검사: 보고서 정보 빈 칸과 없는 그림은 승인하면 넘어간다', () => {
  const s = createDefaultInput();
  const probs = reportProblems(s, null, { missing: ['Figure 1.1 P&ID', 'TD01 모델'] });
  const doc = probs.find(p => p.step === 'docinfo');
  assert.equal(doc.level, 'skip');
  assert.ok(doc.text.startsWith('보고서 정보 빈 칸'));
  assert.deepEqual(probs.filter(p => p.step === 'figures').map(p => [p.level, p.text]), [['skip', '없는 그림 2개: Figure 1.1 P&ID, TD01 모델']]);
  assert.ok(!reportProblems(s, null).some(p => p.step === 'figures'));
});

import { reviewGroupOf, reviewStepOf, summarizeReview } from './psaReport.js';

test('검토 결과: 위치 글을 보고서 묶음으로, 필요한 자료를 화면 단계로', () => {
  assert.equal(reviewGroupOf('표지 › Title'), '표지와 초록');
  assert.equal(reviewGroupOf('호선 문장 3곳 (초록, 1장, 표지)'), '표지와 초록');
  assert.equal(reviewGroupOf('Figure 1.1 P&ID'), '1장 Introduction');
  assert.equal(reviewGroupOf('Table 2.4 Displacement'), '2장 Design conditions');
  assert.equal(reviewGroupOf('1장, 2.2 사용 프로그램'), '2장 Design conditions');
  assert.equal(reviewGroupOf('6장 Table 6.1 최대 반력 (TD01)'), '6장 TD01');
  assert.equal(reviewGroupOf('6장 Table 6.15 응력 요약 (TD06-1)'), '6장 TD06');
  assert.equal(reviewGroupOf('6장 Figure 6.9 Piping model for TD06-4'), '6장 TD06');
  assert.equal(reviewGroupOf('6장 Table 6.19 최대 반력 (Compressor Room)'), '6장 COMP.RM');
  assert.equal(reviewGroupOf('6장 TD02 › Material'), '6장 TD02');
  assert.equal(reviewGroupOf('7장 Table 7.1 압축기 노즐 하중 표'), '7장 Nozzle load');

  assert.equal(reviewStepOf('보고서 정보 단계'), 'docinfo');
  assert.equal(reviewStepOf("그림 폴더에 'TD01.png' 같은 이름의 그림"), 'figures');
  assert.equal(reviewStepOf('CAESAR II Code Compliance 엑셀'), 'files');
  assert.equal(reviewStepOf('Scope 단계의 재질'), 'docinfo');
  assert.equal(reviewStepOf('Displacement 단계'), 'displacement');
  assert.equal(reviewStepOf('모름'), null);
});

test('검토 결과 요약: 빠진 자리를 모으고 묶음은 보고서 순서', () => {
  const r = summarizeReview({ items: [
    { kind: 'calc', where: '6장 Table 6.1 최대 반력 (TD01)' },
    { kind: 'missing', where: '표지 › Client', source: '보고서 정보 단계' },
    { kind: 'input', where: 'Table 2.4 Displacement' },
    { kind: 'missing', where: '6장 Table 6.2 응력 요약 (TD01)' },
  ] });
  assert.equal(r.missing.length, 2);
  assert.deepEqual(r.groups.map(g => [g.name, g.items.length, g.missing]), [
    ['표지와 초록', 1, 1], ['2장 Design conditions', 1, 0], ['6장 TD01', 2, 1],
  ]);
  assert.deepEqual(summarizeReview(null), { missing: [], groups: [] });
});

import { pendingChoices, reviewBlocks } from './psaReport.js';

test('검토: 고르기 남은 칸은 서버로 보내고, 검토는 고르기 때문에 막지 않는다', () => {
  const fc = { choose: [{ lineNo: 'TD03', label: 'Restraint Summary', uid: 'L3', kind: 'restraint', model: 1 }, { lineNo: 'X', label: 'y' }] };
  assert.deepEqual(pendingChoices(fc), [{ lineNo: 'TD03', kind: 'restraint', model: 1 }]);
  assert.deepEqual(pendingChoices(null), []);
  const probs = [
    { level: 'block', kind: 'choose', text: 'a' },
    { level: 'block', kind: 'lines', text: 'b' },
    { level: 'skip', kind: 'missing', text: 'c' },
  ];
  assert.deepEqual(reviewBlocks(probs).map(p => p.text), ['b']);
});
