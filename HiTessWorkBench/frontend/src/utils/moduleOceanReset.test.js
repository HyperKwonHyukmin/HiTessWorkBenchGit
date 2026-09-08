import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MODULE_OCEAN_ARRANGEMENT,
  DEFAULT_MODULE_OCEAN_CONTACT_TOL_MM,
  resetModuleOceanPlacementState,
} from './moduleOceanReset.js';

test('전체 초기화용 배치 리셋은 적치·지지점·후보를 모두 제거한다', () => {
  const received = {};
  const setter = (key) => (value) => { received[key] = value; };

  resetModuleOceanPlacementState({
    setArrangement: setter('arrangement'),
    setContactTolMm: setter('contactTolMm'),
    setShowCog: setter('showCog'),
    setDeckContingencyPct: setter('deckContingencyPct'),
    setModuleContingencyPct: setter('moduleContingencyPct'),
    setSeating: setter('seating'),
    setSeatingBusy: setter('seatingBusy'),
    setSupportPickerOpen: setter('supportPickerOpen'),
    setSupportIdx: setter('supportIdx'),
    setRotationCandidates: setter('rotationCandidates'),
  });

  assert.deepEqual(received.arrangement, DEFAULT_MODULE_OCEAN_ARRANGEMENT);
  assert.equal(received.contactTolMm, DEFAULT_MODULE_OCEAN_CONTACT_TOL_MM);
  assert.equal(received.showCog, true);
  assert.equal(received.deckContingencyPct, 0);
  assert.equal(received.moduleContingencyPct, 0);
  assert.equal(received.seating, null);
  assert.equal(received.seatingBusy, false);
  assert.equal(received.supportPickerOpen, false);
  assert.ok(received.supportIdx instanceof Set);
  assert.equal(received.supportIdx.size, 0);
  assert.equal(received.rotationCandidates, null);
});

test('배치 기본값은 호출 사이에 공유되지 않는다', () => {
  const arrangements = [];
  const resetters = {
    setArrangement: (value) => arrangements.push(value),
  };

  resetModuleOceanPlacementState(resetters);
  resetModuleOceanPlacementState(resetters);

  assert.notEqual(arrangements[0], arrangements[1]);
  assert.deepEqual(arrangements[0], arrangements[1]);
});
