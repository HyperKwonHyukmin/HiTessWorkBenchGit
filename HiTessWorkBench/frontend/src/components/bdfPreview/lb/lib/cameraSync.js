/**
 * 비교 화면 카메라 동기화(07 §2) — 순수 함수. 엔진 좌표(각 모델 bbox 중심이 원점)로 계산한다.
 *
 * 카메라 상태 = { projection, position[3], target[3], quaternion[4], up[3], view, radius, center[3] }
 *   view   = 화면 짧은 쪽 반폭(모델 단위). 직교는 min(반폭, 반높이)/zoom, 원근은 거리·tan(시야각/2).
 *            Studio useCameraSync 교훈 — 직교 카메라는 position/quaternion 만 맞추면 배율(zoom)이 어긋난다.
 *            그래서 zoom 대신 '보이는 크기'를 넘기고, 받는 쪽 엔진이 자기 화면 틀로 zoom 을 다시 셈한다.
 *   radius = 모델 bbox 반지름, center = 모델 bbox 중심(원래 좌표).
 *
 * 방식
 *   'scale'(각 모델 크기 기준, 기본) — 방향은 그대로, 거리·target·보이는 크기는 모델 반지름 비율로.
 *   'same'(같은 좌표)               — 원래 좌표의 위치·target·보이는 크기를 그대로(같은 좌표계 개정판).
 */
export const SYNC_MODES = ['scale', 'same'];
export const SYNC_MODE_LABELS = { scale: '각 모델 크기 기준', same: '같은 좌표' };

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/** src 카메라를 dst 모델에 옮긴 상태(받는 쪽 엔진의 setCameraState 입력). */
export function syncCamera(src, dst, mode = 'scale') {
  const offset = sub(src.position, src.target);
  let target;
  let k = 1;
  if (mode === 'same') {
    // 원래 좌표 = 엔진 좌표 + center. 받는 쪽 엔진 좌표 = 원래 좌표 − 받는 쪽 center.
    const shift = sub(src.center || [0, 0, 0], dst.center || [0, 0, 0]);
    target = add(src.target, shift);
  } else {
    k = src.radius > 0 && dst.radius > 0 ? dst.radius / src.radius : 1;
    target = mul(src.target, k);
  }
  return {
    projection: src.projection,
    target,
    position: add(target, mul(offset, k)),
    quaternion: src.quaternion ? [...src.quaternion] : null,
    up: src.up ? [...src.up] : [0, 0, 1],
    view: src.view != null ? src.view * k : null,
  };
}

/** 직교 카메라 zoom — 화면 틀(zoom=1 일 때의 반폭·반높이)과 보일 크기(view)로. */
export function orthoZoom(halfWidth, halfHeight, view) {
  const base = Math.min(Math.abs(halfWidth), Math.abs(halfHeight));
  if (!(view > 0) || !(base > 0)) return 1;
  return base / view;
}

/** 원근 카메라 거리 → 보이는 짧은 쪽 반폭(시야각 fov 도). */
export const perspView = (distance, fovDeg) => distance * Math.tan((fovDeg * Math.PI) / 360);
