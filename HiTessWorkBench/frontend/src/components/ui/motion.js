/**
 * 앱 전체 모션 공통 값 (2026-10-01 대시보드·앱 화면 모션 정리).
 *
 * 원칙: '처음 한 번' 또는 '상태를 말하는' 움직임만 쓴다. 장식용 반복 모션은 두지 않는다.
 * 곡선은 ease-out-quart — 튀거나 되돌아오지 않는다. 시간은 0.2~0.7s.
 * 동작 줄이기: framer-motion 은 main.jsx 의 MotionConfig(reducedMotion="user"),
 * CSS 애니메이션은 index.css 의 전역 규칙이 즉시 끝낸다. 명령형 animate() 는 useReducedMotion 으로 직접 거른다.
 */
export const EASE_OUT = [0.25, 1, 0.5, 1];

/** 결과·판정이 '도착' 할 때 쓰는 짧은 등장 */
export const ARRIVE = { duration: 0.24, ease: EASE_OUT };
