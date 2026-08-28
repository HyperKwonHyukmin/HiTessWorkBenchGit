/**
 * 유한요소 연결도 → 렌더링용 인덱스 변환 (순수 함수).
 *
 * FeModelViewer 에서 분리해 둔 이유는 두 가지다.
 *  1. 6만 요소 규모에서 인덱스가 하나만 어긋나도 화면이 조용히 깨진다 — 단위 테스트가 필요하다.
 *  2. three.js·React 의존 없이 Node 에서 그대로 돌릴 수 있다.
 *
 * 입력 연결도는 백엔드 슬림 페이로드의 **0-based 절점 인덱스**다(node id 가 아니다).
 */

/**
 * 쉘 연결도를 삼각형 인덱스로 변환한다. CQUAD4 는 대각선 (0-2) 로 두 삼각형으로 나눈다.
 *
 * @param {number[]} quads 4개씩 묶인 쿼드 연결도
 * @param {number[]} trias 3개씩 묶인 삼각형 연결도
 * @returns {number[]} 3개씩 묶인 삼각형 인덱스
 */
export function buildTriangleIndices(quads = [], trias = []) {
  const out = [];
  for (let i = 0; i + 3 < quads.length; i += 4) {
    const a = quads[i], b = quads[i + 1], c = quads[i + 2], d = quads[i + 3];
    out.push(a, b, c, a, c, d);
  }
  for (let i = 0; i + 2 < trias.length; i += 3) {
    out.push(trias[i], trias[i + 1], trias[i + 2]);
  }
  return out;
}

/**
 * 쉘 요소의 **요소 경계선**을 만든다.
 *
 * 인접한 두 요소가 공유하는 변은 한 번만 그린다. 중복을 남기면 63,392 CQUAD4 기준
 * 25만 선분이 겹쳐 그려져 GPU 낭비일 뿐 아니라, 반투명 표시에서 공유 변만 진하게 보인다.
 *
 * @param {number[]} quads
 * @param {number[]} trias
 * @param {number} nodeCount 절점 수 — 정점쌍을 하나의 정수 키로 접는 데 쓴다.
 * @returns {number[]} 2개씩 묶인 선분 인덱스
 */
export function buildShellEdgeIndices(quads = [], trias = [], nodeCount = 0) {
  const seen = new Set();
  const out = [];

  const push = (a, b) => {
    if (a === b) return;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    // 정점쌍 → 유일한 정수 키. nodeCount 를 진법으로 쓰면 (lo,hi) 조합이 충돌하지 않는다.
    const key = lo * nodeCount + hi;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(lo, hi);
  };

  for (let i = 0; i + 3 < quads.length; i += 4) {
    const a = quads[i], b = quads[i + 1], c = quads[i + 2], d = quads[i + 3];
    push(a, b); push(b, c); push(c, d); push(d, a);
  }
  for (let i = 0; i + 2 < trias.length; i += 3) {
    const a = trias[i], b = trias[i + 1], c = trias[i + 2];
    push(a, b); push(b, c); push(c, a);
  }
  return out;
}

/**
 * 인덱스 배열을 GPU 로 올릴 TypedArray 로 만든다.
 *
 * ⚠ 절점이 65,535 개를 넘으면 Uint16 으로는 표현할 수 없다(정반만 66,816 개).
 *   조용히 잘린 인덱스는 모델을 엉뚱하게 이어 붙인 형상으로 만들기 때문에 경계값이 중요하다.
 */
export function toIndexArray(indices, vertexCount) {
  return vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
}

/**
 * Module Unit 배치 좌표 계산.
 *
 * 규칙(사용자 확정):
 *  · Module Unit 은 자체 XY 중심·바닥면을 기준점(anchor)으로 삼는다 → 회전축이 자기 평면 중심이 된다.
 *  · 기본 배치 = 정반 전체 XY 중심 정렬 + 정반 상면에서 gapMm 만큼 위.
 *
 * @param {{min:number[],max:number[]}} deckBounds   정반 바운딩박스
 * @param {{min:number[],max:number[]}|null} moduleBounds Module Unit 바운딩박스
 * @param {{gapMm:number,offsetXMm:number,offsetYMm:number}} arrangement
 */
export function computeModulePlacement(deckBounds, moduleBounds, arrangement) {
  if (!deckBounds?.min || !deckBounds?.max) return null;
  const { min: dMin, max: dMax } = deckBounds;
  const deckTopZ = dMax[2];
  const deckCenter = [(dMin[0] + dMax[0]) / 2, (dMin[1] + dMax[1]) / 2];

  if (!moduleBounds?.min || !moduleBounds?.max) {
    return { deckTopZ, deckCenter, anchor: null, position: null, moduleSize: null };
  }

  const { min: mMin, max: mMax } = moduleBounds;
  const anchor = [(mMin[0] + mMax[0]) / 2, (mMin[1] + mMax[1]) / 2, mMin[2]];
  const position = [
    deckCenter[0] + (arrangement?.offsetXMm ?? 0),
    deckCenter[1] + (arrangement?.offsetYMm ?? 0),
    deckTopZ + (arrangement?.gapMm ?? 0),
  ];

  return {
    deckTopZ,
    deckCenter,
    anchor,
    position,
    moduleBottomZ: position[2],
    moduleTopZ: position[2] + (mMax[2] - mMin[2]),
    moduleSize: [mMax[0] - mMin[0], mMax[1] - mMin[1], mMax[2] - mMin[2]],
  };
}
