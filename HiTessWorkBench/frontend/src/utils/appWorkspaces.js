/**
 * 해석 앱 '작업 탭' 공용 규칙 — 순수 함수 모음(앱별 규칙은 createWorkspaceKit 인자로 받는다).
 *
 * 작업 탭 하나 = 그 앱의 해석 과정 하나(입력 → 실행·판정 → Studio → 산출물). 탭마다 다른 모델을
 * 동시에 진행하고(탭별 Studio 창 · 탭별 Job Center 기록), 페이지는 탭마다 같은 작업 화면 컴포넌트를
 * 하나씩 띄운다. 적용 앱: HiTESS Model Builder(modelBuilderWorkspaces) · GMU 권상(gmuLiftingWorkspaces).
 *
 * 저장 형태: { activeId, nextSeq, workspaces: [{ id, seq, slotNo }], states: { [id]: 작업 화면 상태 } }
 *
 * ⚠ 메뉴로 새로 들어오면(fresh entry) 진행 중이거나 결과가 있는 탭은 남기고 빈 탭 하나를 열어 그 탭으로
 *   간다 — 메뉴를 다시 눌렀다고 다른 모델의 작업이 사라지면 안 된다. 대시보드 파일 전달·결과 다시 열기·
 *   다른 앱의 연계(handoff)도 이 빈 탭이 받는다.
 * ⚠ 작업 번호(slotNo, 1~MAX)는 탭의 고정 정체성이다. 탭·Job Center·Studio 창 제목이 모두 '작업 N' 으로
 *   같은 작업을 가리킨다. 탭을 닫아도 다른 탭의 번호는 바뀌지 않고, 새 탭은 비어 있는 가장 작은 번호를
 *   쓴다(위치 순번을 쓰면 하나를 닫을 때 남은 탭의 번호가 바뀌어 이미 떠 있는 Studio 창 제목과 어긋난다).
 */

/** 동시에 둘 수 있는 작업 탭 수. 탭마다 Studio 창(렌더러 + 3D 장면)이 따로 떠서 PC 메모리를 먹는다. */
export const MAX_APP_WORKSPACES = 4;

let idCounter = 0;
function newWorkspaceId() {
  idCounter += 1;
  return `ws-${Date.now().toString(36)}-${idCounter}`;
}

function makeStore(workspaces, states, activeId, nextSeq) {
  return { activeId, nextSeq, workspaces, states };
}

function nextSlotNo(workspaces, max) {
  const used = new Set(workspaces.map(ws => ws.slotNo));
  for (let n = 1; n <= max; n += 1) if (!used.has(n)) return n;
  return workspaces.length + 1;
}

/** Electron viewer-sessions.normalizeSourceKey 와 같은 규칙(역슬래시·대소문자·끝 슬래시 무시). */
export function normalizePath(p) {
  if (typeof p !== 'string') return '';
  return p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * 앱별 탭 규칙 묶음을 만든다.
 * @param {{ isIdle: (state:any)=>boolean, max?: number }} rules
 *   isIdle — 탭이 아직 아무것도 하지 않은 상태인가(입력·실행 기록·다시 연 결과 없음).
 *            메뉴 재진입 때 정리 대상이자, 대시보드 전달·연계를 받을 수 있는 탭의 조건이다.
 */
export function createWorkspaceKit({ isIdle, max = MAX_APP_WORKSPACES }) {
  const addEmpty = (store) => {
    const ws = { id: newWorkspaceId(), seq: store.nextSeq, slotNo: nextSlotNo(store.workspaces, max) };
    return makeStore([...store.workspaces, ws], store.states, ws.id, store.nextSeq + 1);
  };

  /** 저장값을 탭 저장 형태로 맞춘다. null 이면 빈 탭 1개, 예전 단일 페이지 상태면 그것을 첫 탭으로 감싼다. */
  const normalize = (store) => {
    if (store && Array.isArray(store.workspaces) && store.workspaces.length > 0) {
      const active = store.workspaces.some(ws => ws.id === store.activeId)
        ? store.activeId
        : store.workspaces[0].id;
      const maxSeq = Math.max(...store.workspaces.map(ws => Number(ws.seq) || 0));
      // 작업 번호가 없는 탭(도입 전 저장값)에는 빈 번호를 채운다.
      let workspaces = store.workspaces;
      if (!workspaces.every(ws => ws.slotNo)) {
        const filled = workspaces.filter(ws => ws.slotNo);
        workspaces = workspaces.map((ws) => {
          if (ws.slotNo) return ws;
          const next = { ...ws, slotNo: nextSlotNo(filled, max) };
          filled.push(next);
          return next;
        });
      }
      return makeStore(
        workspaces,
        store.states || {},
        active,
        Math.max(Number(store.nextSeq) || 0, maxSeq + 1),
      );
    }
    const empty = addEmpty(makeStore([], {}, null, 1));
    if (store && typeof store === 'object' && !Array.isArray(store.workspaces)) {
      // 예전 형태(작업 화면 상태 하나) — 첫 탭의 상태로 옮긴다.
      return { ...empty, states: { [empty.activeId]: store } };
    }
    return empty;
  };

  const canAdd = (store) => (store?.workspaces?.length ?? 0) < max;

  return {
    max,
    isIdle,
    normalize,
    canAdd,

    /** 메뉴로 새로 들어왔을 때. 빈 탭은 정리하고 빈 탭 하나를 열어 활성화한다. 가득 차 있으면 그대로 둔다. */
    freshEntry(store) {
      const norm = normalize(store);
      const kept = norm.workspaces.filter(ws => !isIdle(norm.states[ws.id]));
      const states = {};
      for (const ws of kept) states[ws.id] = norm.states[ws.id];
      const base = makeStore(
        kept,
        states,
        kept.some(ws => ws.id === norm.activeId) ? norm.activeId : (kept[kept.length - 1]?.id ?? null),
        norm.nextSeq,
      );
      if (kept.length >= max) return base;
      return addEmpty(base);
    },

    /** 새 빈 탭을 열고 그 탭으로 간다. 이미 가득 차 있으면 그대로 돌려준다(canAdd 로 먼저 확인). */
    add(store) {
      const norm = normalize(store);
      return canAdd(norm) ? addEmpty(norm) : norm;
    },

    /** 탭을 닫는다. 활성 탭을 닫으면 오른쪽(없으면 왼쪽) 이웃으로, 마지막 탭이면 빈 탭 하나를 새로 연다. */
    close(store, id) {
      const norm = normalize(store);
      const idx = norm.workspaces.findIndex(ws => ws.id === id);
      if (idx < 0) return norm;
      const workspaces = norm.workspaces.filter(ws => ws.id !== id);
      const states = { ...norm.states };
      delete states[id];
      if (workspaces.length === 0) return addEmpty(makeStore([], {}, null, norm.nextSeq));
      const activeId = norm.activeId === id
        ? (workspaces[idx] ?? workspaces[idx - 1]).id
        : norm.activeId;
      return makeStore(workspaces, states, activeId, norm.nextSeq);
    },

    activate(store, id) {
      const norm = normalize(store);
      if (!norm.workspaces.some(ws => ws.id === id) || norm.activeId === id) return norm;
      return { ...norm, activeId: id };
    },

    /** 작업 화면이 자기 상태를 저장한다. 그 사이 닫힌 탭이면 무시한다(닫힌 탭이 되살아나지 않게). */
    save(store, id, state) {
      const norm = normalize(store);
      if (!norm.workspaces.some(ws => ws.id === id)) return norm;
      return { ...norm, states: { ...norm.states, [id]: state } };
    },

    /** 상태 조건으로 탭을 찾는다(Studio 가 보낸 이벤트가 어느 탭의 것인지). */
    find(store, predicate) {
      const norm = normalize(store);
      return norm.workspaces.find(ws => predicate(norm.states[ws.id] || null, ws)) || null;
    },
  };
}
