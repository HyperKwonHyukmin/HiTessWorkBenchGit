/**
 * Studio 원본 모델 갱신 알림.
 *
 * Studio 를 여러 개 동시에 띄울 수 있게 되면서 생긴 실질 위험 하나를 막는다:
 * WorkBench 에서 모델을 다시 만들어도, 그 모델을 입력으로 이미 열려 있는 Studio 창은
 * 옛 모델을 든 채 남는다. 사용자가 그걸 모르고 그 창에서 구조해석을 걸면 이전 모델이
 * 해석된다 — 오류 없이 조용히 진행되므로 알아채기 어렵다.
 *
 * 그래서 새 모델을 만든 직후 이 함수를 부르면, Electron main 이 해당 Studio 가 열려 있고
 * 다른 모델(sourceKey 불일치)을 보고 있을 때만 그 창 위에 경고 배너를 그린다.
 * Studio 가 안 떠 있거나 같은 모델이면 main 이 무시하므로 호출측은 조건을 따질 필요가 없다.
 *
 * @param {string} viewerId  대상 Studio id (예: 'model-studio', 'module-unit-studio')
 * @param {string} sourceKey 새로 만들어진 모델의 식별자(서버측 산출 폴더 또는 BDF 경로)
 * @param {string} [message] 배너 문구 (미지정 시 main 의 기본 문구)
 * @returns {Promise<boolean>} 실제로 배너를 띄웠으면 true
 */
export async function notifyStudioSourceUpdated(viewerId, sourceKey, message) {
  if (!viewerId || !sourceKey) return false;
  // Electron 밖(브라우저 개발 모드)에서는 Studio 자체가 없으므로 무시한다.
  if (!window.electron?.invoke) return false;
  try {
    const res = await window.electron.invoke('viewer:notifySourceUpdated', {
      viewerId,
      sourceKey,
      message,
    });
    return !!res?.notified;
  } catch {
    // 알림 실패가 해석 흐름을 막아서는 안 된다.
    return false;
  }
}
