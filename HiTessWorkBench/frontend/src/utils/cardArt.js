/**
 * 카탈로그 카드 선화 선택 규칙(순수 함수). 그림 자체는 components/ui/cardArt.jsx.
 * 앱의 art 필드 → 분류 기본값(CATEGORY_ART) → null(모눈 + 분류 이름표만).
 */

export const CARD_ART_NAMES = ['truss', 'frame', 'pipe', 'lift', 'beam', 'column', 'plate', 'weld', 'hull', 'doc'];

// 분류 기본 그림. 여기에 없는 분류는 선화 없이 모눈과 이름표만 나온다.
export const CATEGORY_ART = {
  '구조 모델': 'frame',
  '배관': 'pipe',
  '권상·의장': 'lift',
  '운송': 'hull',
  '1D Beam': 'beam',
  'Section': 'beam',
  'Weld': 'weld',
  'Lifting': 'lift',
  'Plate': 'plate',
  'Tank': 'hull',
  'Davit': 'beam',
  'Column': 'column',
  'Fatigue': 'plate',
  'Lug': 'weld',
  'Carling': 'plate',
  'BDF Tools': 'frame',
  'F06 Tools': 'doc',
  'Hull Accel': 'hull',
  'Report': 'doc',
};



export function resolveCardArtName(app = {}) {
  if (app.art && CARD_ART_NAMES.includes(app.art)) return app.art;
  return CATEGORY_ART[app.category] ?? null;
}
