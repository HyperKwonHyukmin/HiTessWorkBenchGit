---
name: project-independent-tank
description: IndependentTankAssessment 페이지 탭 구조 전환 이력 및 패턴 — 에러 배지, BC 카드 레이아웃
metadata:
  type: project
---

## IndependentTankAssessment 탭 구조 (2026-05-21 전환)

**전환 전:** 상단 2컬럼(좌 Geometry+Stiffener / 우 3D 뷰어) + 하단 풀폭 Boundary & Load 3카드  
**전환 후:** 좌측 탭 패널(Design 탭 / Boundary/Load 탭) + 우측 3D 뷰어 (항상 표시)

### 탭 헤더 디자인 결정
- 라이브러리 없이 inline 탭 (`const [activeTab, setActiveTab] = useState('design')`)
- 활성: `bg-white border-slate-200 text-violet-700 shadow-sm z-10`
- 비활성: `bg-slate-100/70 border-slate-200/60 text-slate-500 hover:text-violet-600`
- 탭 헤더 하단에 `flex-1 border-b border-slate-200` 구분선으로 콘텐츠 컨테이너와 시각 연결
- 탭 콘텐츠 컨테이너: `border border-slate-200 rounded-b-xl rounded-tr-xl bg-white shadow-sm`

### 에러 배지 패턴
```jsx
const designHasError = ![...validations].every(v => v.ok);
// 탭 헤더 안에서:
{designHasError && (
  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-extrabold">!</span>
)}
```

### BC 선택 수 배지 (Boundary 탭)
- 탭 헤더에도 violet pill 배지로 선택된 BC 수 표시 (`bcRows.length > 0` 조건)
- BC 탭 안에서 안내 배너: `bg-violet-50 border border-violet-200/70 rounded-lg` — 뷰어 상호작용 강조

### Boundary 탭 레이아웃
- Air Vent + 가속도: `grid-cols-2` 나란히 (세로 입력 형식으로 가속도 ax/ay/az 배치)
- BC 카드: 풀폭. max-h-[200px] (기존 130px → 여유 확보)

### 절대 수정 금지 영역
- `IndependentTankViewer` 함수 컴포넌트 (line 1~655 영역)
- `buildSectionShape`, `positionsAlong` 헬퍼
- 모든 useState / 검증 useMemo / handlePickPoint / handleJobSubmit

**Why:** 입력 필드가 많아 한 화면에 모두 노출 시 산만. 탭으로 분리하여 집중도 향상.  
**How to apply:** 유사한 입력-뷰어 분할 페이지에 동일 패턴 적용 가능. 뷰어는 항상 우측에 고정.
