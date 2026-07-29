import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTeePolygon,
  orientSectionResultForApp,
} from './sectionPropertyGeometry.js';

test('Tee의 상단은 선체판에 접하는 스템이고 하단은 플랜지다', () => {
  const polygon = createTeePolygon({ h: 150, bf: 150, tf: 10, tw: 6 });
  const ymax = Math.max(...polygon.map(point => point.y));
  const ymin = Math.min(...polygon.map(point => point.y));
  const widthAt = y => {
    const xs = polygon.filter(point => point.y === y).map(point => point.x);
    return Math.max(...xs) - Math.min(...xs);
  };

  assert.equal(widthAt(ymax), 6, '선체판 접합면은 스템 폭이어야 한다');
  assert.equal(widthAt(ymin), 150, '선체판 반대편에는 Tee 플랜지가 있어야 한다');
});

test('Tee 계산 결과의 상하 방향값도 X축 기준으로 반전한다', () => {
  const engineResult = {
    centroid: { x: 0, y: 5 },
    Ixy: 12,
    Sx_top: 100,
    Sx_bot: 250,
    principal: { angle: 0.25, Imax: 10, Imin: 5 },
    shearCenter: { x: 0, y: -7 },
    bbox: { xmin: -75, xmax: 75, ymin: -40, ymax: 110 },
    polygon: [{ x: 0, y: -40 }, { x: 0, y: 110 }],
  };

  const result = orientSectionResultForApp('tee', engineResult);

  assert.deepEqual(result.centroid, { x: 0, y: -5 });
  assert.equal(result.Ixy, -12);
  assert.equal(result.Sx_top, 250);
  assert.equal(result.Sx_bot, 100);
  assert.equal(result.principal.angle, -0.25);
  assert.deepEqual(result.shearCenter, { x: 0, y: 7 });
  assert.deepEqual(result.bbox, {
    xmin: -75,
    xmax: 75,
    ymin: -110,
    ymax: 40,
  });
  assert.deepEqual(result.polygon, [{ x: 0, y: 40 }, { x: 0, y: -110 }]);
  assert.deepEqual(engineResult.bbox, {
    xmin: -75,
    xmax: 75,
    ymin: -40,
    ymax: 110,
  }, '엔진 원본 결과는 변경하지 않아야 한다');
});

test('Tee 외 형상의 계산 결과 방향은 변경하지 않는다', () => {
  const result = { bbox: { ymin: -10, ymax: 20 } };

  assert.equal(orientSectionResultForApp('angle', result), result);
});
