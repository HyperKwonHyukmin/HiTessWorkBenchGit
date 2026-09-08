import assert from 'node:assert/strict';
import test from 'node:test';

import { createFeOrthographicCamera, resizeFeOrthographicCamera } from './feModelCamera.js';

test('FE 모델 카메라는 처음부터 정투영이다', () => {
  const camera = createFeOrthographicCamera(1200, 600, { halfHeight: 500 });

  assert.equal(camera.isOrthographicCamera, true);
  assert.equal(camera.isPerspectiveCamera, undefined);
  assert.equal(camera.left, -1000);
  assert.equal(camera.right, 1000);
  assert.equal(camera.top, 500);
  assert.equal(camera.bottom, -500);
});

test('창 크기가 바뀌어도 정투영 카메라와 세로 범위를 유지한다', () => {
  const camera = createFeOrthographicCamera(1000, 500, { halfHeight: 400 });
  resizeFeOrthographicCamera(camera, 600, 600);

  assert.equal(camera.isOrthographicCamera, true);
  assert.equal(camera.left, -400);
  assert.equal(camera.right, 400);
  assert.equal(camera.top, 400);
  assert.equal(camera.bottom, -400);
});
