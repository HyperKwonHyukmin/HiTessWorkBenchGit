// Studio(viewer) 세션 레지스트리 — Electron 의존성이 없는 순수 로직.
//
// 배경: 과거 main 프로세스는 Studio 창을 1개만 두고(viewerWindow) 컨텍스트도 전역 1벌
// (initialFolder / parentAnalysisId / outputDir …)만 유지했다. 그래서 다른 Studio 를 열면
// 먼저 띄운 창이 교체되고 컨텍스트도 덮어써져, Model Builder Studio 와 Module Unit Studio 를
// 오가며 작업할 수 없었다.
//
// ⚠️ 이 레지스트리의 존재 이유이자 핵심 규약:
//   Studio 가 호출하는 IPC 는 반드시 "요청을 보낸 창"(webContents.id)으로 자기 세션을 찾는다.
//   "현재 활성 Studio" 전역을 두고 창 전환 시 스왑하는 방식은 쓰지 않는다 — 백그라운드
//   Studio 가 IPC 를 한 번이라도 호출하면 다른 Studio 의 컨텍스트로 해석 요청이 나가고,
//   오류 없이 조용히 잘못된 모델이 해석되기 때문이다.
//   따라서 fromWebContentsId() 는 못 찾으면 반드시 null 이며, 절대 다른 세션으로 폴백하지 않는다.
"use strict";

const defaultIsAlive = (win) => !!win && typeof win.isDestroyed === "function" && !win.isDestroyed();

class ViewerSessionRegistry {
  /**
   * @param {(win:any)=>boolean} [isAlive] 창이 살아 있는지 판정. 기본값은 Electron BrowserWindow 규약.
   */
  constructor(isAlive = defaultIsAlive) {
    this.isAlive = isAlive;
    this._byViewerId = new Map();        // viewerId → session
    this._viewerIdByWebContents = new Map(); // webContents.id → viewerId
  }

  /**
   * 세션 등록/갱신. webContentsId 를 주면 발신 창 역매핑도 함께 등록한다.
   * 같은 viewerId 로 다시 등록하면 컨텍스트가 교체된다(같은 Studio 를 다른 모델로 재오픈).
   */
  register(session, webContentsId) {
    if (!session || !session.viewerId) throw new Error("session.viewerId 필요");
    this._byViewerId.set(session.viewerId, session);
    if (webContentsId !== undefined && webContentsId !== null) {
      this._viewerIdByWebContents.set(webContentsId, session.viewerId);
    }
    return session;
  }

  /** viewerId 로 세션 조회(창 생존 여부는 보지 않음). */
  get(viewerId) {
    return this._byViewerId.get(viewerId) || null;
  }

  /**
   * IPC 발신 창의 webContents.id 로 세션 해소.
   * 못 찾으면 null — 다른 세션으로 폴백하지 않는다(위 규약).
   */
  fromWebContentsId(webContentsId) {
    const viewerId = this._viewerIdByWebContents.get(webContentsId);
    if (!viewerId) return null;
    return this._byViewerId.get(viewerId) || null;
  }

  /**
   * 창이 닫혔을 때 정리. webContentsId 역매핑을 반드시 함께 지운다 —
   * 남겨두면 id 가 재사용될 때 죽은 Studio 의 컨텍스트로 IPC 가 해소될 수 있다.
   * win 을 주면 "그 창을 쓰는 세션일 때만" 지운다(같은 viewerId 를 새 창이 이미 차지한 경우 보호).
   */
  remove(viewerId, webContentsId, win) {
    if (webContentsId !== undefined && webContentsId !== null) {
      this._viewerIdByWebContents.delete(webContentsId);
    }
    const session = this._byViewerId.get(viewerId);
    if (session && (win === undefined || session.win === win)) {
      this._byViewerId.delete(viewerId);
    }
  }

  /** 살아 있는 세션 목록. 죽은 세션은 이 시점에 정리한다. */
  live() {
    const alive = [];
    for (const [viewerId, session] of this._byViewerId) {
      if (this.isAlive(session.win)) alive.push(session);
      else this._byViewerId.delete(viewerId);
    }
    return alive;
  }

  /** 세션의 창을 반환. 죽었거나 없으면 null. */
  windowOf(session) {
    return this.isAlive(session && session.win) ? session.win : null;
  }
}

/**
 * 열려 있는 Studio 가 보고 있는 모델이 새 모델로 대체됐는지 판정한다.
 *
 * 거짓 경보를 내지 않는 쪽으로 보수적이다 — 어느 한쪽이라도 식별자를 모르면 '판단 불가'로
 * 보고 경보하지 않는다. 매번 뜨는 경고 배너는 사용자가 곧 무시하게 되므로, 정말 모델이
 * 갈아엎힌 경우에만 떠야 한다.
 *
 * @param {{sourceKey?: string|null}|null} session 열려 있는 Studio 세션
 * @param {string|null|undefined} nextSourceKey 새로 만들어진 모델의 식별자
 */
function isSourceStale(session, nextSourceKey) {
  if (!session || !session.sourceKey || !nextSourceKey) return false;
  return session.sourceKey !== nextSourceKey;
}

module.exports = { ViewerSessionRegistry, isSourceStale };
