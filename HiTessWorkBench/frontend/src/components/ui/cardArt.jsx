/**
 * 앱 카드 위쪽 '도면 띠' 의 선화 라이브러리.
 *
 * 앱마다 그림을 새로 그리지 않는다 — 구조 형태별 그림 몇 장을 두고 골라 쓴다.
 * 선택 순서(resolveCardArt): 앱의 `art` 필드 → 분류 기본값(CATEGORY_ART) → 없음(모눈 + 분류 이름표만).
 * 그래서 그림을 정하지 않은 새 앱이 추가돼도 카드가 깨지지 않는다.
 *
 * ⚠ 새 그림 규격: viewBox 104×54, 단색(currentColor) 선, 굵기 1.4(보조선 1.0 · 점선),
 *   절점은 흰 채움 원. 규격이 같아야 누가 언제 추가해도 한 벌로 보인다.
 * ⚠ 그림을 추가하면 utils/cardArt.js 의 CARD_ART_NAMES 에도 이름을 넣을 것(분류 기본값은 거기 있다).
 * 선화는 배경 장식이다 — 모드 아이콘 통일 결정(DashboardContext 주석)과 무관하게 쓸 수 있다.
 */

import { resolveCardArtName } from '../../utils/cardArt';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round', strokeLinecap: 'round' };
const THIN = { ...S, strokeWidth: 1, strokeDasharray: '2.5 2.5' };
const Node = ({ x, y, r = 2.1 }) => <circle cx={x} cy={y} r={r} fill="#fff" stroke="currentColor" strokeWidth="1.3" />;

const ART = {
  truss: (
    <>
      <path {...S} d="M4 44H100M16 12H88M4 44L16 12L28 44L40 12L52 44L64 12L76 44L88 12L100 44" />
      <path {...S} strokeWidth="1" d="M0 50h8M96 50h8" />
      {[4, 28, 52, 76, 100].map(x => <Node key={`b${x}`} x={x} y={44} />)}
      {[16, 40, 64, 88].map(x => <Node key={`t${x}`} x={x} y={12} />)}
    </>
  ),
  frame: (
    <>
      <path {...S} d="M14 46V18L38 8V36ZM38 36L78 46V18L38 8M14 46L54 54L78 46M14 18L54 28L78 18M54 28V54M14 32L54 42L78 32" />
      <path {...THIN} d="M14 46L54 28M54 54L78 18" />
      <Node x={14} y={46} /><Node x={54} y={54} /><Node x={78} y={46} /><Node x={14} y={18} />
      <Node x={54} y={28} /><Node x={78} y={18} /><Node x={38} y={8} />
    </>
  ),
  pipe: (
    <>
      <path {...S} d="M2 30H52A14 14 0 0 0 66 16V4M2 42H52A26 26 0 0 0 78 16V4M22 26V46M27 26V46M62 12H82M62 7H82" />
      <path {...S} strokeWidth="1" strokeDasharray="6 3 1.5 3" d="M2 36H50A20 20 0 0 0 72 16V4" />
      <path {...S} strokeWidth="1" d="M90 36h10M95 31v10" />
    </>
  ),
  lift: (
    <>
      <path {...S} d="M52 2V8M52 8L22 32M52 8L82 32M52 8L42 32M52 8L62 32M18 32H86V50H18ZM34 32V50M52 32V50M70 32V50M18 41H86" />
      <path {...THIN} d="M18 32L34 50M34 32L52 50M52 32L70 50M70 32L86 50" />
      <Node x={52} y={8} r={2.4} />
    </>
  ),
  beam: (
    <>
      <path {...S} d="M10 24H94M10 30H94M10 24V30M94 24V30" />
      <path {...S} d="M22 30L16 40H28ZM82 30L76 40H88Z" />
      <path {...S} strokeWidth="1" d="M14 44H30M74 44L90 44M78 44l-3 4M84 44l-3 4M90 44l-3 4" />
      <path {...S} d="M40 6V20M52 6V20M64 6V20M37 16l3 4 3-4M49 16l3 4 3-4M61 16l3 4 3-4" />
      <path {...THIN} d="M10 27Q52 38 94 27" />
    </>
  ),
  column: (
    <>
      <path {...S} d="M46 8H58M46 48H58M50 8V48M54 8V48" />
      <path {...S} d="M52 2V6M49 3l3 4 3-4" />
      <path {...THIN} d="M52 8Q66 28 52 48" />
      <path {...S} d="M36 48H68M40 48l-4 5M48 48l-4 5M56 48l-4 5M64 48l-4 5" strokeWidth="1" />
      <path {...S} strokeWidth="1" d="M74 10V46M72 12l2-3 2 3M72 44l2 3 2-3" />
    </>
  ),
  plate: (
    <>
      <path {...S} d="M8 40L40 50L96 34L64 24ZM24 45L80 29M40 50L40 42L96 26V34M40 42L8 32V40" />
      <path {...S} d="M24 37V45M56 32V40" strokeWidth="1" />
      <path {...THIN} d="M20 36L76 20" />
      <circle cx="66" cy="36" r="4" {...S} strokeWidth="1.2" />
    </>
  ),
  weld: (
    <>
      <path {...S} d="M6 44H98M6 50H98M40 44V20A12 12 0 0 1 64 20V44" />
      <circle cx="52" cy="22" r="5" {...S} />
      <path {...S} d="M34 44L40 38M64 38L70 44" />
      <path {...S} strokeWidth="1" d="M52 8V2M49 5l3-3 3 3" />
      <path {...THIN} d="M28 44V52M76 44V52" />
    </>
  ),
  hull: (
    <>
      <path {...S} d="M6 18H98L92 38Q52 50 12 38Z" />
      <path {...S} d="M30 18V8H62V18M40 8V4H52V8" />
      <path {...S} strokeWidth="1" d="M2 44Q12 40 22 44T42 44T62 44T82 44T102 44" />
      <path {...THIN} d="M16 28H94" />
    </>
  ),
  doc: (
    <>
      <path {...S} d="M30 4H62L74 16V52H30ZM62 4V16H74" />
      <path {...S} strokeWidth="1" d="M36 24H68M36 30H68M36 36H58" />
      <path {...S} d="M36 44H44V48H36ZM48 41H56V48H48ZM60 38H68V48H60Z" strokeWidth="1.1" />
      <path {...THIN} d="M78 20H96M78 28H92" />
    </>
  ),
};

/** 앱 → 그림 키. 앱의 art 필드 → 분류 기본값 → null. 그림이 라이브러리에 없으면 null. */
export function resolveCardArt(app = {}) {
  const name = resolveCardArtName(app);
  return name && ART[name] ? name : null;
}

export function CardArt({ name, className = '' }) {
  const body = ART[name];
  if (!body) return null;
  return (
    <svg viewBox="0 0 104 54" className={className} aria-hidden="true" focusable="false">
      {body}
    </svg>
  );
}
