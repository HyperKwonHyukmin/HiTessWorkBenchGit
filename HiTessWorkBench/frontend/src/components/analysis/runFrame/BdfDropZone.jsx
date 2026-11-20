import React, { useState } from 'react';
import { CheckCircle2, FileText, Upload } from 'lucide-react';

/**
 * 공통 틀 — 모델 BDF 입력 칸(클릭, 끌어 놓기). 올린 뒤에는 파일명과 '다른 BDF' 를 보여 준다.
 * 처음 구현 = TrussAssessment(2026-10-02). Truss Module Lifting 도 같은 칸을 쓴다(2026-11-17).
 *
 * file:      File | null (file.sample 이면 '서버 모델' 문구)
 * inputRef:  숨은 <input type=file> ref — 페이지가 단축키 등에서 열 수 있게 밖에서 받는다
 * onFile:    (File) => void — 확장자 검사는 페이지가 한다(끌어 놓기는 accept 를 거치지 않는다)
 * label:     머리 이름표 (기본 '모델 BDF')
 * accept:    확장자 목록 (기본 ['.bdf', '.dat'])
 * pickedNote: 올린 뒤 파일명 아래 안내 (기본 '눌러서 다른 파일로 바꾸기')
 */
export default function BdfDropZone({
  file, inputRef, disabled, onFile, label = '모델 BDF', accept = ['.bdf', '.dat'], pickedNote,
}) {
  const [over, setOver] = useState(false);
  const pick = () => { if (!disabled) inputRef.current?.click(); };
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <FileText size={13} className="text-slate-600" aria-hidden="true" />
        <span className="text-xs font-bold text-slate-800">{label}</span>
        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-800">필수</span>
        <span className="text-[11px] text-slate-600">{accept.join(' / ')}</span>
        {file && !disabled && (
          <button type="button" onClick={pick} className="ml-auto rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer">
            다른 BDF
          </button>
        )}
      </div>
      <input type="file" accept={accept.join(',')} className="hidden" ref={inputRef} onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
      <button
        type="button"
        onClick={pick}
        disabled={disabled}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFile(e.dataTransfer.files[0]); }}
        className={`flex w-full flex-col items-center justify-center gap-1 px-4 py-6 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50 disabled:cursor-not-allowed cursor-pointer ${over ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
      >
        {file ? (
          <>
            <CheckCircle2 size={18} className="text-emerald-600" aria-hidden="true" />
            <span className="max-w-full truncate text-sm font-semibold text-slate-800">{file.name}</span>
            <span className="text-xs text-slate-600">{pickedNote ?? (file.sample ? '서버 모델(샘플·지난 결과)' : '눌러서 다른 파일로 바꾸기')}</span>
          </>
        ) : (
          <>
            <Upload size={16} className="text-slate-500" aria-hidden="true" />
            <span className="text-xs text-slate-600">{accept[0]} 파일을 놓거나 <span className="font-semibold text-blue-700">눌러서 선택</span></span>
          </>
        )}
      </button>
    </div>
  );
}
