import React, { useEffect, useState } from 'react';
import { X, FileSpreadsheet, FileType2, Loader2 } from 'lucide-react';
import { EXTRA_NOTICE_MAX, initialReportForm, isPositiveNumber, isReportFormValid, toReportOptions } from '../../utils/unitLiftingReport';

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

// 출력 형식. PDF 는 백엔드가 만든 xlsx 를 서버 Excel 로 인쇄해 변환한다(라우터 format=pdf).
// 배포용은 PDF 가 기본 — 서식이 고정되어 받는 사람 환경에 따라 달라지지 않는다.
// Studio 의 UnitStructuralReportDialog 와 같은 선택지다(한쪽을 고치면 양쪽 다).
const FORMATS = [
  ['pdf', 'PDF', FileType2, '서식 고정 · 배포용'],
  ['xlsx', 'Excel(xlsx)', FileSpreadsheet, '수치 복사 · 편집용'],
];

/**
 * Unit 권상 검토 보고서 표지 정보 입력 모달.
 * Studio 의 UnitStructuralReportDialog 와 같은 필드를 쓴다(백엔드 options 키 동일).
 *
 * props: open, sourceFileName, defaultAuthor, busy, onClose(), onSubmit(options, format)
 */
export default function UnitLiftingReportDialog({
  open, kind = 'result', sourceFileName = '', defaultAuthor = '', busy = false, onClose, onSubmit,
}) {
  const [form, setForm] = useState(() => initialReportForm(sourceFileName, defaultAuthor));
  const [format, setFormat] = useState('pdf');

  useEffect(() => {
    if (open) {
      setForm(initialReportForm(sourceFileName, defaultAuthor));
      setFormat('pdf');
    }
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
  const extraLen = [...String(form.extraNotice ?? '')].length;   // 서로게이트 쌍을 1자로 센다
  const submit = () => { if (valid && !busy) onSubmit?.(toReportOptions(form), format); };

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
          {kind !== 'detail' && (
            // 사내 표준 서식의 '주의 사항' 5행. 4행까지는 고정 문구이고 이 한 줄만 사용자가 적는다.
            // 입력이 없으면 백엔드가 그 줄을 감춰 4줄짜리 박스로 인쇄한다.
            <label className="col-span-2 flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
              <span className="flex items-center justify-between">
                <span>주의 사항 문구 추가 (선택)</span>
                <span className={extraLen > EXTRA_NOTICE_MAX * 0.9 ? 'text-amber-600' : 'text-slate-400'}>
                  {extraLen} / {EXTRA_NOTICE_MAX}자
                </span>
              </span>
              <input
                aria-label="주의 사항 문구 추가"
                type="text"
                maxLength={EXTRA_NOTICE_MAX}
                placeholder="비워 두면 4줄로 인쇄됩니다"
                value={form.extraNotice}
                onChange={set('extraNotice')}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#002554]/30"
              />
            </label>
          )}
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
          <div className="col-span-2 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">출력 형식</span>
            <div role="radiogroup" aria-label="출력 형식" className="flex gap-2">
              {FORMATS.map(([value, label, Icon, hint]) => {
                const on = format === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={label}
                    onClick={() => setFormat(value)}
                    className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg border px-3 py-2 ${
                      on ? 'border-[#002554] bg-[#002554]/5 text-[#002554]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-bold">
                      <Icon size={14} /> {label}
                    </span>
                    <span className="text-[10px] font-medium text-slate-400">{hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
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
            {format === 'pdf' ? 'PDF 생성' : 'Excel 생성'}
          </button>
        </div>
      </div>
    </div>
  );
}
