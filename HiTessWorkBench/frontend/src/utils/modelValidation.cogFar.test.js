import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEquipmentCogFar, describeDiagnostic } from './modelValidation.js';

test('EQUIPMENT_COG_FAR 메시지에서 장비·거리·질량·COG 를 읽는다', () => {
  const p = parseEquipmentCogFar({ code: 'EQUIPMENT_COG_FAR', elemId: 911, nodeId: 1028,
    message: 'Equipment rigid 911 (COG N1028) is 49554mm from its nearest attachment; SourceName==30137/754429; distance=49554mm; massKg=715; cog=(61449, -2916, 33057)mm. Check the cog value in the equipment CSV.' });
  assert.deepEqual(p, { rigidId: 911, cogNodeId: 1028, sourceName: '=30137/754429', distanceMm: 49554, massKg: 715, cogMm: [61449, -2916, 33057] });
  assert.equal(parseEquipmentCogFar({ code: 'SHORT_ELEMENT', message: '' }), null);
  assert.equal(describeDiagnostic({ code: 'EQUIPMENT_COG_FAR' }).title, '장비 무게중심(COG) 위치 오류');
});
