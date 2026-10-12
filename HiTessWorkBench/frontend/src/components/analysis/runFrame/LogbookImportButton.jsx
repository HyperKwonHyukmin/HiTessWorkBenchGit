// Hi-TESS LogBook 에서 가져오기 — 버튼 + 창 열기 훅(GMU 권상 · Truss Structural Assessment 공용).
//
// 버튼을 누르면 /api/logbook/launch 로 30초 일회 코드 주소를 받아 LogBook 창을 연다.
//   - Electron: open-app-window + bridge:'logbook' (그 창에만 window.hitessBridge 가 붙어 [WorkBench로 보내기]가 보인다)
//   - 브라우저(개발 모드): window.open — 다리가 없으므로 보내기 버튼도 없다.
// 보낸 모델을 받는 쪽('logbook:model-picked' 수신·회신)은 각 페이지가 맡는다(utils/logbookLink).
import React, { useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { launchLogbook } from '../../../api/logbook';
import { LOGBOOK_WINDOW_KEY, logbookErrorMessage } from '../../../utils/logbookLink';

/**
 * LogBook 창 열기.
 * @param {{ target: 'gmu'|'truss', slot?: number, showToast: Function, openedMessage: string }} opts
 * @returns {{ open: () => Promise<void>, launching: boolean }}
 */
export function useLogbookLauncher({ target, slot, showToast, openedMessage }) {
  const [launching, setLaunching] = useState(false);
  const open = async () => {
    const inElectron = !!window.electron?.invoke;
    // 브라우저(개발 모드)는 사용자 클릭 안에서 창을 먼저 열어야 팝업 차단을 피한다. 보내기 다리는 없다.
    const fallbackWindow = inElectron ? null : window.open('about:blank', '_blank');
    if (fallbackWindow) fallbackWindow.opener = null;
    setLaunching(true);
    try {
      const { data } = await launchLogbook({ target, slot });
      if (inElectron) {
        const result = await window.electron.invoke('open-app-window', {
          url: data.url,
          title: 'Hi-TESS LogBook',
          windowKey: data.windowKey || LOGBOOK_WINDOW_KEY,
          bridge: 'logbook',
        });
        if (result?.ok === false) throw new Error(result.error || 'LogBook 창을 열지 못했습니다.');
      } else if (fallbackWindow) {
        fallbackWindow.location.replace(data.url);
      } else {
        throw new Error('브라우저가 새 창 열기를 차단했습니다.');
      }
      showToast(openedMessage, 'info');
    } catch (e) {
      if (fallbackWindow && !fallbackWindow.closed) fallbackWindow.close();
      showToast(`LogBook 을 열지 못했습니다 — ${logbookErrorMessage(e)}`, 'error');
    } finally {
      setLaunching(false);
    }
  };
  return { open, launching };
}

/** 입력 칸 아래에 두는 [Hi-TESS LogBook에서 가져오기] 버튼 + 한 줄 안내. */
export default function LogbookImportButton({ onClick, disabled, launching, hint }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || launching}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:border-blue-400 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
      >
        {launching
          ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          : <BookOpen size={13} className="text-slate-500" aria-hidden="true" />}
        Hi-TESS LogBook에서 가져오기
      </button>
      {hint && <span className="text-[11px] text-slate-600">{hint}</span>}
    </div>
  );
}
