import test from 'node:test';
import assert from 'node:assert/strict';

import { readBlobErrorDetail } from './httpErrors.js';

test('blob 오류 본문에서 detail 을 꺼낸다', async () => {
  const error = { response: { data: new Blob([JSON.stringify({ detail: '완료된 해석만 가능합니다' })]) } };
  assert.equal(await readBlobErrorDetail(error, '기본 문구'), '완료된 해석만 가능합니다');
});

test('JSON 이 아닌 blob 은 기본 문구로 떨어진다', async () => {
  const error = { response: { data: new Blob(['<html>502</html>']) } };
  assert.equal(await readBlobErrorDetail(error, '기본 문구'), '기본 문구');
});

test('detail 이 없는 JSON blob 도 기본 문구', async () => {
  const error = { response: { data: new Blob([JSON.stringify({ message: 'nope' })]) } };
  assert.equal(await readBlobErrorDetail(error, '기본 문구'), '기본 문구');
});

test('blob 이 아닌 평범한 JSON 응답도 처리한다', async () => {
  const error = { response: { data: { detail: '접근 권한이 없는 작업입니다' } } };
  assert.equal(await readBlobErrorDetail(error, '기본 문구'), '접근 권한이 없는 작업입니다');
});

test('응답 자체가 없으면 기본 문구', async () => {
  assert.equal(await readBlobErrorDetail(new Error('network down'), '기본 문구'), '기본 문구');
});
