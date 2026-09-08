import * as THREE from 'three';

/** FE 모델용 정투영 카메라를 만든다. */
export function createFeOrthographicCamera(width, height, {
  halfHeight = 1000,
  near = 0.1,
  far = 5_000_000,
} = {}) {
  const safeWidth = Math.max(Number(width) || 1, 1);
  const safeHeight = Math.max(Number(height) || 1, 1);
  const safeHalfHeight = Math.max(Number(halfHeight) || 1, 1);
  const aspect = safeWidth / safeHeight;
  return new THREE.OrthographicCamera(
    -safeHalfHeight * aspect,
    safeHalfHeight * aspect,
    safeHalfHeight,
    -safeHalfHeight,
    near,
    far,
  );
}

/** 창 크기 변경 시 세로 범위는 유지하고 가로 범위만 종횡비에 맞춘다. */
export function resizeFeOrthographicCamera(camera, width, height) {
  if (!camera?.isOrthographicCamera) {
    throw new TypeError('FE 모델 뷰어는 정투영 카메라만 지원합니다.');
  }
  const safeWidth = Math.max(Number(width) || 1, 1);
  const safeHeight = Math.max(Number(height) || 1, 1);
  const halfHeight = Math.max((camera.top - camera.bottom) / 2, 1e-9);
  const aspect = safeWidth / safeHeight;
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.updateProjectionMatrix();
  return camera;
}
