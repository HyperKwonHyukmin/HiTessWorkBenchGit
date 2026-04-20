import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { API_BASE_URL } from '../config';

const PHASE = { IDLE: 'idle', DOWNLOADING: 'downloading', DONE: 'done', ERROR: 'error' };

export default function UpdateModal({ currentVersion, serverVersion }) {
  const [phase, setPhase]       = useState(PHASE.IDLE);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const remove = window.electron?.onMessage('download-progress', (data) => {
      if (data.done) {
        if (data.error) {
          setPhase(PHASE.ERROR);
          setErrorMsg(String(data.error));
        } else {
          setPhase(PHASE.DONE);
          setProgress(100);
        }
      } else if (data.progress >= 0) {
        setProgress(data.progress);
      }
    });
    return () => { if (remove) remove(); };
  }, []);

  const handleUpdate = async () => {
    setPhase(PHASE.DOWNLOADING);
    setProgress(0);
    setErrorMsg('');
    try {
      await window.electron.invoke('start-self-update', `${API_BASE_URL}/api/download/client`);
    } catch (err) {
      setPhase(PHASE.ERROR);
      setErrorMsg(err?.message || '알 수 없는 오류');
    }
  };

  const handleRetry = () => {
    setPhase(PHASE.IDLE);
    setProgress(0);
    setErrorMsg('');
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">

        <div className="bg-red-600 px-6 py-4 flex items-center gap-3">
          <AlertTriangle className="text-white shrink-0" size={22} />
          <h2 className="text-white font-bold text-base">업데이트 필요</h2>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-sm font-mono space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">현재 버전</span>
              <span className="font-bold text-red-500">v{currentVersion}</span>
            </div>
            <div className="border-t border-slate-200 pt-2 flex justify-between">
              <span className="text-slate-500">최신 버전</span>
              <span className="font-bold text-emerald-600">v{serverVersion}</span>
            </div>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed">
            새 버전이 배포되었습니다. 업데이트 후 자동으로 재시작됩니다.
          </p>

          {phase === PHASE.DOWNLOADING && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-500">
                <span>다운로드 중...</span>
                <span>{progress >= 0 ? `${progress}%` : '연결 중...'}</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                {progress >= 0
                  ? <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                  : <div className="bg-blue-400 h-2 rounded-full animate-pulse w-full" />
                }
              </div>
            </div>
          )}

          {phase === PHASE.DONE && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-medium">
              <CheckCircle size={18} />
              <span>HiTESS WorkBench v{serverVersion}으로 자동 업데이트됩니다.</span>
            </div>
          )}

          {phase === PHASE.ERROR && (
            <div className="flex items-start gap-2 text-red-600 text-sm">
              <XCircle size={18} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 px-6 py-4 bg-slate-50">
          {phase === PHASE.IDLE && (
            <button
              onClick={handleUpdate}
              className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-colors shadow cursor-pointer"
            >
              <Download size={18} />
              지금 업데이트
            </button>
          )}
          {phase === PHASE.DOWNLOADING && (
            <button
              disabled
              className="w-full py-3 bg-slate-300 text-slate-500 rounded-xl font-bold cursor-not-allowed"
            >
              다운로드 중... {progress >= 0 ? `${progress}%` : ''}
            </button>
          )}
          {phase === PHASE.ERROR && (
            <button
              onClick={handleRetry}
              className="w-full flex items-center justify-center gap-2 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-colors cursor-pointer"
            >
              <RefreshCw size={18} />
              재시도
            </button>
          )}
          {phase === PHASE.DONE && (
            <p className="text-center text-xs text-slate-400">v{serverVersion} 설치 완료 — 잠시 후 자동으로 실행됩니다.</p>
          )}
        </div>

      </div>
    </div>
  );
}
