import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Trash2, AlertTriangle, Info, CheckCircle2, RotateCcw, Check, Maximize2, Minimize2,
} from 'lucide-react';
import FeModelViewer from './FeModelViewer';
import {
  evaluateSupportSelection, selectionPoints, rigidDependentIndices,
} from '../../utils/supportSelection';

/**
 * 지지점 지정 모달 — **Module Unit 만** 띄운다.
 *
 * 2단계 뷰어는 정반과 Unit 을 함께 보여 주는데, 정반이 Unit 밑면을 가려 지지점으로
 * 삼을 절점을 찍기가 어렵다. 여기서는 정반을 빼고 Unit 을 모델 좌표 그대로(배치 변환
 * 없이) 띄워서 밑면을 자유롭게 돌려 볼 수 있게 한다.
 *
 * 선택은 **초안(draft)** 으로 들고 있다가 '적용' 할 때만 부모에 넘긴다 —
 * 이것저것 찍어 보다 취소해도 원래 선택이 남아야 한다.
 */

const LEVEL_STYLE = {
  block: { box: 'border-red-400/40 bg-red-500/10', text: 'text-red-300', Icon: AlertTriangle },
  warn:  { box: 'border-amber-400/40 bg-amber-500/10', text: 'text-amber-300', Icon: AlertTriangle },
  info:  { box: 'border-slate-600 bg-slate-800/60', text: 'text-slate-300', Icon: Info },
};

export default function SupportPickerModal({ open, onClose, model, selected, onApply }) {
  const [draft, setDraft] = useState(() => new Set(selected));
  // 절점을 찍는 작업이라 화면이 넓을수록 유리하다 — 모달 자체를 전체 화면으로 넓힌다.
  const [maximized, setMaximized] = useState(false);

  // 열 때마다 현재 확정 선택에서 시작한다.
  useEffect(() => { if (open) setDraft(new Set(selected)); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const rigidDependent = useMemo(() => rigidDependentIndices(model), [model]);
  const points = useMemo(() => selectionPoints(model, draft), [model, draft]);
  const evaluation = useMemo(() => evaluateSupportSelection(points, {
    cogMm: model?.massProperties?.centerOfGravityMm,
    rigidDependent,
  }), [points, model, rigidDependent]);

  // 정반 없이 Unit 만, 배치 변환 없이 모델 좌표 그대로 띄운다.
  const parts = useMemo(() => (model ? [{
    id: 'module-unit',
    name: 'Module Unit',
    color: '#7dd3fc',
    model,
  }] : []), [model]);

  const pick = useMemo(() => ({
    partId: 'module-unit', selected: draft, onChange: setDraft,
  }), [draft]);

  if (!open) return null;

  const m2 = (mm2) => (mm2 / 1.0e6).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm
                     ${maximized ? 'p-0' : 'p-4'}`}>
      <div className={`flex flex-col bg-white shadow-2xl overflow-hidden
                       ${maximized ? 'w-full h-full rounded-none' : 'w-full max-w-[1400px] h-[90vh] rounded-2xl'}`}>
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800">지지점 지정 — Module Unit</h3>
            <p className="text-[11px] text-slate-500 truncate">
              스툴을 놓을 절점을 고릅니다 · 선택한 절점은 발밑 적치면 절점에 RBE2 로 연결됩니다
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setMaximized(v => !v)}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
              title={maximized ? '창 크기로' : '전체 화면'}
            >
              {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
              title="닫기 (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0">
            {model ? (
              <FeModelViewer parts={parts} pick={pick} initialShowRigids />
            ) : (
              <div className="h-full flex items-center justify-center bg-slate-900">
                <p className="text-xs text-slate-400">Module Unit 모델이 없습니다. 1단계 검증을 먼저 완료하세요.</p>
              </div>
            )}
          </div>

          <div className="w-72 shrink-0 border-l border-slate-200 bg-slate-900 flex flex-col min-h-0">
            <div className="p-3 border-b border-slate-700/60">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">조작</p>
              <ul className="space-y-1 text-[10px] text-slate-300">
                <li><b className="text-emerald-300">좌클릭</b> — 절점 추가·해제</li>
                <li><b className="text-emerald-300">우클릭</b> — 절점 해제(지우개)</li>
                <li><b className="text-emerald-300">Shift + 드래그</b> — 박스로 추가</li>
                <li><b className="text-emerald-300">Alt + 드래그</b> — 박스로 해제</li>
                <li><b className="text-slate-400">드래그</b> — 회전 · <b className="text-slate-400">휠</b> — 확대</li>
                <li className="pt-1 text-slate-400">
                  밑면을 보려면 <b className="text-slate-300">저면(2)</b> 또는 <b className="text-slate-300">정면(3)</b> 뷰를 쓰세요.
                </li>
              </ul>
            </div>

            <div className="p-3 border-b border-slate-700/60 grid grid-cols-2 gap-2">
              <Stat label="지지점" value={`${draft.size.toLocaleString()}개`} strong />
              <Stat label="지지 면적" value={`${m2(evaluation.hullAreaMm2)} m²`} />
              <Stat label="X 범위" value={`${Math.round(evaluation.spanMm[0]).toLocaleString()} mm`} />
              <Stat label="Y 범위" value={`${Math.round(evaluation.spanMm[1]).toLocaleString()} mm`} />
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-3 space-y-1.5">
              {draft.size > 0 && evaluation.issues.length === 0 && (
                <div className="flex items-start gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-1.5">
                  <CheckCircle2 size={12} className="mt-px shrink-0 text-emerald-400" />
                  <p className="text-[10px] leading-relaxed text-emerald-300">
                    지지점이 넓게 퍼져 있고 무게중심이 지지 다각형 안에 있습니다.
                  </p>
                </div>
              )}
              {evaluation.issues.map((issue) => {
                const st = LEVEL_STYLE[issue.level] || LEVEL_STYLE.info;
                return (
                  <div key={issue.code} className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 ${st.box}`}>
                    <st.Icon size={12} className={`mt-px shrink-0 ${st.text}`} />
                    <p className={`text-[10px] leading-relaxed ${st.text}`}>{issue.message}</p>
                  </div>
                );
              })}
            </div>

            <div className="p-3 border-t border-slate-700/60 space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setDraft(new Set())}
                  disabled={draft.size === 0}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-slate-600
                             text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed
                             text-[11px] font-bold transition-colors cursor-pointer"
                >
                  <Trash2 size={11} /> 전체 지우기
                </button>
                <button
                  onClick={() => setDraft(new Set(selected))}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-slate-600
                             text-slate-300 hover:bg-slate-800 text-[11px] font-bold transition-colors cursor-pointer"
                >
                  <RotateCcw size={11} /> 되돌리기
                </button>
              </div>
              <button
                onClick={() => { onApply?.(new Set(draft)); onClose?.(); }}
                disabled={!evaluation.ok}
                title={evaluation.ok ? '이 선택으로 확정합니다'
                  : evaluation.issues.find(i => i.level === 'block')?.message}
                className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold
                            transition-colors ${evaluation.ok
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                              : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}
              >
                <Check size={13} /> 지지점 {draft.size}개 적용
              </button>
              {!evaluation.ok && (
                <p className="text-[10px] leading-relaxed text-red-300">
                  {evaluation.issues.find(i => i.level === 'block')?.message}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, strong }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] text-slate-500 truncate">{label}</p>
      <p className={`text-[11px] font-mono truncate ${strong ? 'font-bold text-emerald-400' : 'text-slate-200'}`}>
        {value}
      </p>
    </div>
  );
}
