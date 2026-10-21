/**
 * 3D 데이터 색 — Model Builder Studio(`utils/colors.js`·`utils/groupPalette.js`)와 같은 계열(04c 후속).
 * 바탕은 Studio 와 같은 #1A1A2E. UI 토큰(index.css @theme)과 따로 두고, 엔진(three)과 화면(목록 색 칸·범례)이
 * 같은 값을 쓰도록 여기 한 곳에 모은다.
 */

/** 단면 종류 색 기준의 쉘 — 절제된 블루 그레이 강철색(색상 214°, 채도 약 13%). 1D 단면 색이 판 위에서 먼저 읽힌다. */
export const SHELL_STEEL = '#7D8A9C';

/**
 * PID 색 12색 — Studio 그룹 팔레트와 같은 '선명하되 형광은 아닌' 계열(채도 60~75%, 밝기 55~65%).
 * #1A1A2E 위에서 모두 구별되고, 선택 시안(#00E5FF)과 겹치는 하늘·청록 색상(180~195°)은 쓰지 않았다
 * (청록 #2DB5A3 은 172° 에 더 어둡다). 이웃한 PID 끼리 색상이 크게 갈리도록 순서를 정했다
 * (연두 #9FCB55 와 노랑 #E3CF72 사이에 남색을 끼웠다). Studio 조명 아래 면이 탁해지지 않게 밝기 55~65%.
 */
export const PID_COLORS = ['#4D8FEF', '#EDAE3B', '#E8587D', '#3DC584', '#9A79F2', '#EE7D3E',
                           '#2DB5A3', '#D865C2', '#9FCB55', '#6E7FD8', '#E3CF72', '#B5BFCC'];

export function pidColor(pid) {
  return PID_COLORS[((pid % PID_COLORS.length) + PID_COLORS.length) % PID_COLORS.length];
}

/**
 * 표시물 색 — Studio colors.js: RBE(rigid) 0xFF44FF 마젠타 · 질량 0xFF99BB · 경계조건 0x22DD66.
 * RBE3 는 Studio 에 없다 — RBE2 마젠타의 형제 톤 #D58CFF(색상 285°, 더 밝고 푸른 오키드):
 * 같은 '강체/보간 연결' 집안으로 읽히면서, 보간 요소(RBE3)는 강체(RBE2)보다 부드러운 색이라 한눈에 갈린다.
 * 고립 절점(#B07BFF)보다 밝고 붉어서 선(RBE3)과 점(고립)을 헷갈리지 않는다.
 */
export const MARKER_COLORS = { rbe2: '#FF44FF', rbe3: '#D58CFF', conm2: '#FF99BB', spc: '#22DD66' };

/**
 * 연결 그룹 색 — Studio `utils/groupPalette.js` 와 같은 11색, 같은 순서.
 * 0번(주 구조)은 노랑. 그룹이 11개를 넘으면 순환한다. ⚠ 엔진 셰이더도 이 순서·개수로 색을 고른다.
 */
export const GROUP_COLORS = ['#FFD23F', '#00C2FF', '#FF4DB8', '#53E36D', '#FF8A3D', '#8B5CF6',
                             '#00D1B2', '#F25F5C', '#B8F35A', '#4D96FF', '#C9CED6'];
/** 어느 그룹에도 들지 않는 것(고립 절점 등). */
export const NO_GROUP_COLOR = '#6B7085';

export function groupColor(index) {
  if (index == null || index < 0) return NO_GROUP_COLOR;
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

/** 단면 종류 색 — PID 팔레트에서 골랐다(같은 계열). 쉘은 기본 쉘색. */
export const SECTION_COLORS = {
  L: '#3DC584', I: '#4D8FEF', H: '#9A79F2', T: '#EDAE3B', BOX: '#EE7D3E', CHAN: '#D865C2',
  TUBE: '#E3CF72', ROD: '#E8587D', BAR: '#9FCB55', OTHER: '#B5BFCC', LINE: '#7A8196', SHELL: SHELL_STEEL,
};

export function sectionColor(type) {
  return SECTION_COLORS[type] || SECTION_COLORS.OTHER;
}

/** 요소 종류(카드) 색 — PID 팔레트에서 골랐다. 모르는 카드는 강철 회색. */
export const CARD_COLORS = {
  CBAR: '#9FCB55', CBEAM: '#4D8FEF', CROD: '#E8587D', CONROD: '#D865C2', CBUSH: '#E3CF72',
  CTRIA3: '#2DB5A3', CTRIA6: '#3DC584', CTRIAR: '#B5BFCC',
  CQUAD4: '#6E7FD8', CQUAD8: '#9A79F2', CQUADR: '#EDAE3B',
};

export function cardColor(card) {
  return CARD_COLORS[card] || '#B5BFCC';
}

/**
 * 절점 점검 색 — Studio colors.js: 기본/공유 0xC3D2E2 · 자유단 0xFFC24D · 고립 0xB07BFF.
 * 순서 = nodeCheck.js 의 NODE_SHARED·NODE_FREE·NODE_ORPHAN.
 */
export const NODE_CLASS_COLORS = ['#C3D2E2', '#FFC24D', '#B07BFF'];

/** 선택 강조 — Studio SelectionHighlight.js: 시안 코어 0x00E5FF(불투명 0.8) 위·아래로 어두운 외곽 0x001318(0.5). */
export const SELECTION_COLORS = { core: '#00E5FF', outline: '#001318' };

/** 축 표시(gizmo) — Studio ThreeViewport 의 축 글자 색. */
export const AXIS_COLORS = { x: '#FF4444', y: '#44CC44', z: '#4488FF' };

/**
 * 판 변경 3D 보기(16) 색 — Okabe–Ito 계열(파랑 쪽 초록·주황·붉은 분홍)을 뷰어 바탕(#1A1A2E)에 맞춰 밝혔다.
 * 색만으로 말하지 않는다: 삭제는 반투명 + 점선, 절점은 원·고리·네모로도 갈린다(범례 글자 함께).
 * ⚠ index.css 의 --color-diff-* (범례 색 칸)와 같은 값.
 */
export const DIFF_COLORS = { added: '#35C9A0', changed: '#F5A524', removed: '#F0607A', unchanged: '#5B6178' };
