import test from 'node:test';
import assert from 'node:assert/strict';

import { describeElementOrigin, enrichDiagnostic, originText } from './modelValidation.js';

// 실측(3615-E31P0): 02 ElementSplit 의 SHORT_ELEMENT E3204 는 01 의 E81 이 교차점 N2384 에서 잘린 조각이다.
const elementSplit = {
  elements: [
    { id: 81, parentElemId: null, startNode: 2384, endNode: 142, sourceName: '=87422/28372' },
    { id: 3204, parentElemId: 81, startNode: 141, endNode: 2384, sourceName: '=87422/28372' },
    { id: 3262, parentElemId: 3179, startNode: 7, endNode: 8 },
  ],
  trace: [
    { action: 'ElementCreated', stage: 'initial', elemId: 81, note: '=87422/28372' },
    { action: 'NodeCreated', stage: 'Intersection', nodeId: 2384, relatedElemId: 81, note: 'intersection of E81↔E2101' },
    { action: 'ElementSplit', stage: 'Intersection', elemId: 3204, relatedElemId: 81, note: 'split into 2 segments' },
    { action: 'ElementCreated', stage: 'NodeEquivalence', elemId: 3179, relatedElemId: 1584 },
  ],
};
const firstIds = new Set([81, 1584]);

test('분할로 생긴 번호는 01 의 원래 요소와 분할 사유를 돌려준다', () => {
  assert.deepEqual(describeElementOrigin(3204, elementSplit, firstIds),
    { ancestorId: 81, reason: '부재 교차점에서 분할', splitNote: 'N2384에서 E81·E2101 교차' });
});

test('요소 목록에 없는 중간 번호는 trace 로 잇는다', () => {
  assert.equal(describeElementOrigin(3262, elementSplit, firstIds).ancestorId, 1584);
});

test('01 에 그대로 있는 번호·01 목록을 모르면 null', () => {
  assert.equal(describeElementOrigin(81, elementSplit, firstIds), null);
  assert.equal(describeElementOrigin(3204, elementSplit, null), null);
});

test('enrichDiagnostic 이 origin 을 싣고 RBE 진단에는 싣지 않는다', () => {
  assert.equal(enrichDiagnostic({ code: 'SHORT_ELEMENT', elemId: 3204 }, elementSplit, firstIds).origin.ancestorId, 81);
  assert.equal(enrichDiagnostic({ code: 'EMPTY_RIGID', elemId: 3204 }, { ...elementSplit, rigids: [] }, firstIds).origin, null);
});

test('CSV 문구', () => {
  const o = describeElementOrigin(3204, elementSplit, firstIds);
  assert.equal(originText(o, '01 Preprocess'), '01 Preprocess의 원래 요소 E81 · 부재 교차점에서 분할 (N2384에서 E81·E2101 교차)');
  assert.equal(originText(null), '');
});
