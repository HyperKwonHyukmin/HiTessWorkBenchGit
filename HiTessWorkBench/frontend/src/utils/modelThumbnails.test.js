import test from 'node:test';
import assert from 'node:assert/strict';
import { hasModelBdf, modelWallGroups, requestModelThumbnail } from './modelThumbnails.js';

const ok = (info) => ({ status: 'Success', ...info });

test('기록에 BDF 가 있고 파일이 보관 중인 성공 작업만 벽에 오른다', () => {
  assert.equal(hasModelBdf(ok({ result_info: { bdf: 'a/b.BDF' } })), true);
  assert.equal(hasModelBdf(ok({ result_info: { bdf_path: 'a/b.bdf' } })), true);
  assert.equal(hasModelBdf(ok({ input_info: { bdf_model: 'a/b.dat' } })), true);
  assert.equal(hasModelBdf(ok({ result_info: { json: 'a/b.json' } })), false);
  assert.equal(hasModelBdf({ status: 'Failed', result_info: { bdf: 'a.bdf' } }), false);
  assert.equal(hasModelBdf(ok({ files_available: false, result_info: { bdf: 'a.bdf' } })), false);
  assert.equal(hasModelBdf(null), false);
});

test('실패한 썸네일은 다음 요청에 다시 그리고, 성공하면 다시 그리지 않는다', async () => {
  let calls = 0;
  const render = async () => {
    calls += 1;
    if (calls === 1) throw new Error('404');
    return 'data:image/jpeg;base64,x';
  };
  assert.equal(await requestModelThumbnail(1, 'test-retry', render), null);
  assert.equal(await requestModelThumbnail(1, 'test-retry', render), 'data:image/jpeg;base64,x');
  assert.equal(await requestModelThumbnail(1, 'test-retry', render), 'data:image/jpeg;base64,x');
  assert.equal(calls, 2);
});

test('모델 벽은 모델이 있는 줄만 최신순으로 자른다', () => {
  const groups = [
    { id: 1, head: ok({ result_info: { bdf: '1.bdf' } }) },
    { id: 2, head: ok({ result_info: {} }) },
    { id: 3, head: ok({ result_info: { bdf: '3.bdf' } }) },
    { id: 4, head: ok({ result_info: { bdf: '4.bdf' } }) },
  ];
  assert.deepEqual(modelWallGroups(groups, 2).map((g) => g.id), [1, 3]);
  assert.deepEqual(modelWallGroups(undefined, 2), []);
});

test('같은 앱·같은 BDF 이름은 폴더가 달라도 최신 1칸만 남는다', () => {
  const row = (id, program, bdf) => ({ id, head: ok({ program_name: program, result_info: { bdf } }) });
  const groups = [row(1, 'MB', 'C:\\x\\1\\A.bdf'), row(2, 'MB', 'C:\\x\\2\\a.BDF'), row(3, 'GMU', 'C:\\x\\3\\a.bdf'), row(4, 'MB', 'C:/x/4/b.bdf')];
  assert.deepEqual(modelWallGroups(groups, 8).map((g) => g.id), [1, 3, 4]);
});
