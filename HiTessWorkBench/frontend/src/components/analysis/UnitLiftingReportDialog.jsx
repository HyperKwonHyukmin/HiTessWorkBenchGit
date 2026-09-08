import React, { useEffect, useState } from 'react';
import { X, FileSpreadsheet, Loader2 } from 'lucide-react';
import { initialReportForm, isPositiveNumber, isReportFormValid, toReportOptions } from '../../utils/unitLiftingReport';

const FIELDS = [
  ['hullNo', '호선 (HULL NO.)', 'text'],
  ['unitNo', '유닛 (UNIT NO.)', 'text'],
  ['drawingNo', '도면 번호', 'text'],
  ['revision', '리비전', 'text'],
  ['author', '작성자', 'text'],
  ['department', '부서', 'text'],
  ['jigLimitTon', '지그 기준 (ton)', 'number'],
  ['yieldStrengthMpa', '항복강도 (MPa)', 'number'],
];

/**
 * Unit 권상 검토 보고서 표지 정보 입력 모달.
 * Studio 의 UnitStructuralReportDialog 와 같은 필드를 쓴다(백엔드 options 키 동일).
 *
 * props: open, sourceFileName, defaultAuthor, busy, onClose(), onSubmit(options)
 */
export default function UnitLiftingReportDialog({
  open, kind = 'result', sourceFileName = '', defaultAuthor = '', busy = false, onClose, onSubmit,
}) {
  const [form, setForm] = useState(() => initialReportForm(sourceFileName, defaultAuthor));

  useEffect(() => {
    if (open) setForm(initialReportForm(sourceFileName, defaultAuthor));
  }, [open, sourceFileName, defaultAuthor]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const valid = isReportFormValid(form);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = () => { if (valid && !busy) onSubmit?.(toReportOptions(form)); };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[520px] max-w-[92vw] rounded-2xl bg-white shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <FileSpreadsheet size={16} className="text-[#002554]" />
            {kind === 'detail' ? '상세 레포트' : '결과 레포트 (사내 표준 서식)'}
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="p-1 rounded hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 px-5 py-4">
          {FIELDS.map(([key, label, type]) => {
            const invalid = type === 'number' && !isPositiveNumber(form[key]);
            return (
              <label key={key} className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
                {label}
                <input
                  aria-label={label}
                  type={type}
                  step="any"
                  value={form[key]}
                  onChange={set(key)}
                  className={`rounded-lg border px-2.5 py-1.5 text-sm font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002554]/30 ${
                    invalid ? 'border-red-300 bg-red-50' : 'border-slate-200'
                  }`}
                />
              </label>
            );
          })}
          <label className="col-span-2 flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
            비고
            <textarea
              aria-label="비고"
              rows={2}
              value={form.notes}
              onChange={set('notes')}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-normal text-slate-800"
            />
          </label>
          <p className="col-span-2 text-[11px] text-slate-400 leading-relaxed">
            호선·유닛은 BDF 파일명에서 자동 추출됩니다. 허용응력 = 항복강도 × 0.8이며,
            지그 기준은 와이어 장력(ton) 판정에 쓰입니다.
            {kind === 'detail'
              ? ' 상세 레포트는 입력·가정·전 결과를 담은 다장 문서입니다.'
              : ' 결과 레포트는 사내 표준 서식(2~3페이지)으로 출력됩니다.'}
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || busy}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[#002554] text-white disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            보고서 생성
          </button>
        </div>
      </div>
    </div>
  );
}
