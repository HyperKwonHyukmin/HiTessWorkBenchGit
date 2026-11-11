/**
 * 지난 Unit 구조 해석 결과를 읽기 전용 Module Unit Studio 창으로 연다(2026-11-11).
 * 계획: docs/plans/2026-11-11-mu-past-structural-result-view.md
 *
 * 자료는 서버(result-set)에서 받고, 창은 Electron(viewer:openPastStructuralResult)이 연다.
 * 의존성(fetchSet·invoke)을 인자로 받아 테스트에서 바꿔 끼운다.
 *
 * @returns {Promise<{ ok: true, warnings: string[] } | { ok: false, error: string }>}
 */
export async function openPastStructuralResult(analysisId, { fetchSet, invoke, serverUrl }) {
  if (!analysisId) return { ok: false, error: '구조 해석 결과가 없습니다.' };
  if (typeof invoke !== 'function') {
    return { ok: false, error: '결과 보기는 WorkBench 앱에서만 열 수 있습니다.' };
  }
  let body;
  try {
    body = (await fetchSet(analysisId))?.data;
  } catch (e) {
    const status = e?.response?.status;
    const detail = e?.response?.data?.detail;
    // 라우트가 없는 옛 서버 = FastAPI 기본 404 ('Not Found')
    if (status === 404 && (!detail || detail === 'Not Found')) {
      return { ok: false, error: '서버가 이 기능을 아직 모릅니다 — 서버 업데이트 후 다시 시도하세요.' };
    }
    return { ok: false, error: typeof detail === 'string' ? detail : (e?.message || '결과 자료를 받지 못했습니다.') };
  }
  if (!body?.model || !body?.result) return { ok: false, error: '결과 자료 형식이 올바르지 않습니다.' };

  const res = await invoke('viewer:openPastStructuralResult', {
    analysisId: body.analysisId ?? analysisId,
    name: body.name ?? null,
    hullNo: body.hullNo ?? null,
    createdAt: body.createdAt ?? null,
    warnings: body.warnings ?? [],
    files: body.files ?? {},
    model: body.model,
    result: body.result,
    stability: body.stability ?? null,
    serverUrl: serverUrl ?? null,
  });
  // preload 가 모르는 채널이면 null — 옛 exe
  if (res === null || res === undefined) {
    return { ok: false, error: 'WorkBench 앱을 최신 버전으로 업데이트해야 결과를 Studio 로 볼 수 있습니다.' };
  }
  if (!res.ok) return { ok: false, error: res.error || 'Studio 를 열지 못했습니다.' };
  return { ok: true, warnings: Array.isArray(body.warnings) ? body.warnings : [] };
}
