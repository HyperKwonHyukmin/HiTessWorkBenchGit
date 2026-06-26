import React from 'react';
import { RotateCcw, Save, Trash2 } from 'lucide-react';

function formatTime(iso) {
  if (!iso) return '저장 대기';
  try {
    return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '저장됨';
  }
}

export default function DraftAutosavePill({ autosave, onRestore }) {
  if (!autosave) return null;
  const savedAt = autosave.lastSavedAt || autosave.draftSavedAt;

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 text-[11px] font-bold text-slate-500 shadow-sm">
      <Save size={12} className="text-emerald-500" />
      <span>Draft {formatTime(savedAt)}</span>
      {autosave.hasDraft && onRestore && (
        <button
          type="button"
          onClick={onRestore}
          className="ml-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-blue-700 hover:bg-blue-100"
          title="저장된 입력 복원"
        >
          <RotateCcw size={10} /> 복원
        </button>
      )}
      {autosave.hasDraft && (
        <button
          type="button"
          onClick={autosave.clearDraft}
          className="inline-flex items-center rounded-full p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="저장된 Draft 삭제"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}
