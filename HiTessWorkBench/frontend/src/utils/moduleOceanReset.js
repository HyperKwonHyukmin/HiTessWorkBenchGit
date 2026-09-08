/** Module Unit 해상 운송 화면의 사용자 배치 기본값.
 *
 * 적치 높이는 여기 없다 — **지지점마다 발밑 적치면 +DECK_CLEARANCE_MM** 에 오도록 파생되기
 * 때문이다(feGeometry.DECK_CLEARANCE_MM / 백엔드 module_ocean_merge.DEFAULT_CLEARANCE_MM).
 * 사용자가 만지는 것은 XY 오프셋과 회전뿐이다.
 */
export const DEFAULT_MODULE_OCEAN_ARRANGEMENT = Object.freeze({
  offsetXMm: 0,
  offsetYMm: 0,
  rotationZDeg: 0,
});

export const DEFAULT_MODULE_OCEAN_CONTACT_TOL_MM = 50;

/**
 * 전체 초기화에서 함께 비워야 하는 과정 2 배치 상태를 한곳에서 관리한다.
 * setter는 선택적으로 받을 수 있어 호출부와 단위 테스트에서 필요한 범위만 연결할 수 있다.
 */
export function resetModuleOceanPlacementState({
  setArrangement,
  setContactTolMm,
  setShowCog,
  setDeckContingencyPct,
  setModuleContingencyPct,
  setSeating,
  setSeatingBusy,
  setSupportPickerOpen,
  setSupportIdx,
  setRotationCandidates,
} = {}) {
  setArrangement?.({ ...DEFAULT_MODULE_OCEAN_ARRANGEMENT });
  setContactTolMm?.(DEFAULT_MODULE_OCEAN_CONTACT_TOL_MM);
  setShowCog?.(true);
  setDeckContingencyPct?.(0);
  setModuleContingencyPct?.(0);
  setSeating?.(null);
  setSeatingBusy?.(false);
  setSupportPickerOpen?.(false);
  setSupportIdx?.(new Set());
  setRotationCandidates?.(null);
}
