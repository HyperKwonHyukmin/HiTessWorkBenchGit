/**
 * 1D 요소 좌표계(04c §2) — Nastran CBAR/CBEAM 규약. 순수 함수(three 없음)라 jsdom 에서 시험한다.
 *
 *   A = GA + WA, B = GB + WB          (오프셋 WA·WB 는 v2 에서 기본 좌표계 벡터)
 *   x = (B − A) / |B − A|
 *   v = 방향 벡터(요소 x-y 평면을 정한다; v2 의 beam_orient — G0 이면 G0 − GA 를 이미 풀어 둔 값)
 *   z = normalize(x × v)
 *   y = z × x
 *
 * v 가 없거나(v1 파일·CROD·CONROD·CBUSH 는 0,0,0) x 와 나란하면 정할 수 없다 → 대체 v 를 쓰고 fallback=true.
 * 대체 v = 전역 Z, 요소가 Z 와 거의 나란하면 전역 X. 결과가 항상 같아(결정적) 다시 열어도 단면이 같은 쪽을 본다.
 *
 * 단면 기하는 국부 좌표 (x∈[0,1], y, z) 로 만들고 인스턴스 행렬이 이렇게 놓는다(three Matrix4.elements, 열 우선):
 *   열0 = x·L,  열1 = y,  열2 = z,  열3 = A
 * 단면 치수는 늘리지 않고 길이 방향만 L 배 한다. 길이 0 이면 0 행렬(그리지 않음).
 */

const FALLBACK_Z = [0, 0, 1];
const FALLBACK_X = [1, 0, 0];
/** |x × v| / |v| 가 이보다 작으면 나란하다고 본다(약 0.06°). */
const PARALLEL_EPS = 1e-3;

/** 한 요소의 좌표계 — 시험·선택 정보용. 대량 계산은 fillBeamFrames 를 쓴다. */
export function beamBasis(ga, gb, v = null, wa = null, wb = null) {
  const a = [ga[0] + (wa?.[0] || 0), ga[1] + (wa?.[1] || 0), ga[2] + (wa?.[2] || 0)];
  const b = [gb[0] + (wb?.[0] || 0), gb[1] + (wb?.[1] || 0), gb[2] + (wb?.[2] || 0)];
  const out = new Float32Array(16);
  const r = writeFrame(out, 0, a[0], a[1], a[2], b[0], b[1], b[2],
    v ? v[0] : 0, v ? v[1] : 0, v ? v[2] : 0);
  if (r.length === 0) return { start: a, end: b, length: 0, x: null, y: null, z: null, fallback: r.fallback };
  const L = r.length;
  return {
    start: a, end: b, length: L, fallback: r.fallback,
    x: [out[0] / L, out[1] / L, out[2] / L],
    y: [out[4], out[5], out[6]],
    z: [out[8], out[9], out[10]],
  };
}

// writeFrame 이 결과를 돌려주는 데 쓰는 재사용 객체(대량 호출에서 할당하지 않게).
const result = { length: 0, fallback: false };

/** out[o..o+15] 에 인스턴스 행렬을 쓴다. 반환 객체는 재사용되므로 바로 읽을 것. */
function writeFrame(out, o, ax, ay, az, bx, by, bz, vx, vy, vz) {
  let xx = bx - ax; let xy = by - ay; let xz = bz - az;
  const L = Math.hypot(xx, xy, xz);
  result.fallback = false;
  if (!(L > 0)) {
    out.fill(0, o, o + 16);
    result.length = 0;
    return result;
  }
  xx /= L; xy /= L; xz /= L;
  const vlen = Math.hypot(vx, vy, vz);
  // z = x × v
  let zx = xy * vz - xz * vy; let zy = xz * vx - xx * vz; let zz = xx * vy - xy * vx;
  let zl = Math.hypot(zx, zy, zz);
  if (!(vlen > 0) || zl < PARALLEL_EPS * vlen) {
    result.fallback = true;
    const f = Math.abs(xz) < 0.95 ? FALLBACK_Z : FALLBACK_X;
    zx = xy * f[2] - xz * f[1]; zy = xz * f[0] - xx * f[2]; zz = xx * f[1] - xy * f[0];
    zl = Math.hypot(zx, zy, zz);
  }
  zx /= zl; zy /= zl; zz /= zl;
  // y = z × x
  const yx = zy * xz - zz * xy; const yy = zz * xx - zx * xz; const yz = zx * xy - zy * xx;
  out[o] = xx * L; out[o + 1] = xy * L; out[o + 2] = xz * L; out[o + 3] = 0;
  out[o + 4] = yx; out[o + 5] = yy; out[o + 6] = yz; out[o + 7] = 0;
  out[o + 8] = zx; out[o + 9] = zy; out[o + 10] = zz; out[o + 11] = 0;
  out[o + 12] = ax; out[o + 13] = ay; out[o + 14] = az; out[o + 15] = 1;
  result.length = L;
  return result;
}

/**
 * 여러 1D 요소의 인스턴스 행렬을 한꺼번에 쓴다(할당 없음 — 큰 모델에서 조각으로 나눠 부른다).
 *
 * @param {object} src
 *   positions  Float32Array 절점 xyz(뷰어 좌표 = bbox 중심을 뺀 값)
 *   beams      Int32Array lbm beams 블록(행 = eid, pid, ga, gb)
 *   orient     Float32Array|null lbm beam_orient(행 = vx, vy, vz)
 *   offsets    Float32Array|null lbm beam_offsets(행 = WA xyz, WB xyz)
 * @param {Int32Array} rows  그릴 beams 행 번호들
 * @param {Float32Array} out 16·rows.length
 * @param {number} from  rows 의 시작 위치(포함)
 * @param {number} to    rows 의 끝 위치(제외)
 * @returns {number} 대체 v 를 쓴 개수
 */
export function fillBeamFrames({ positions, beams, orient = null, offsets = null }, rows, out, from = 0, to = rows.length) {
  let fallbacks = 0;
  for (let k = from; k < to; k += 1) {
    const r = rows[k];
    const ga = beams[r * 4 + 2] * 3;
    const gb = beams[r * 4 + 3] * 3;
    let ax = positions[ga]; let ay = positions[ga + 1]; let az = positions[ga + 2];
    let bx = positions[gb]; let by = positions[gb + 1]; let bz = positions[gb + 2];
    if (offsets) {
      const w = r * 6;
      ax += offsets[w]; ay += offsets[w + 1]; az += offsets[w + 2];
      bx += offsets[w + 3]; by += offsets[w + 4]; bz += offsets[w + 5];
    }
    const vo = r * 3;
    const res = orient
      ? writeFrame(out, k * 16, ax, ay, az, bx, by, bz, orient[vo], orient[vo + 1], orient[vo + 2])
      : writeFrame(out, k * 16, ax, ay, az, bx, by, bz, 0, 0, 0);
    if (res.fallback) fallbacks += 1;
  }
  return fallbacks;
}
