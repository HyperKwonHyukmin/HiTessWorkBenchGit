// PSA 평가보고서 — 보고서 그림 단계.
// 호선마다 다른 그림(P&ID, Hogging/Sagging, Line 별 배관 모델, 노즐 하중 표)은 그림 파일로 받는다.
// 그림 폴더를 통째로 올리면 서버가 파일 이름으로 자리를 맞춘다(규칙 = 백엔드 psa_report_docx.py match_figure).
// 파일 이름 = 보고서 그림(표) 제목 그대로(2026-11-19 사용자 결정). 번호, 대소문자, 띄어쓰기, 기호는 보지 않는다.
// 없는 그림은 보고서 그 자리에 '[ Figure not provided ]' 가 찍힌다.
import React, { useState } from 'react';
import { CheckCircle2, XCircle, FolderOpen, RefreshCw, Loader2, Copy, Check, ImagePlus } from 'lucide-react';
import { FolderPickButton, ExcelPickButton, ExcelDropZone } from './PsaInputTables';

const GRID = 'border border-slate-200';

// 서버 자리 → { number: 'Figure 1.1' | '6장', name: 파일 이름으로 쓸 제목 }. 옛 서버(caption 없음)는 hint 를 그대로.
const slotName = (s) => (s.caption
  ? { number: String(s.label || '').replace(s.caption, '').trim(), name: s.caption }
  : { number: s.label, name: String(s.hint || '').replace(/\.png$/i, '') });

/** 파일 이름 칸 — 제목을 눌러 복사(탐색기에서 이름 바꿀 때 붙여 넣기) */
function NameCell({ name }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 복사가 막히면 글자를 직접 고르면 된다
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className="min-w-0 select-all break-words text-slate-900">{name}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={`'${name}' 복사`}
        title="파일 이름 복사"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
      >
        {copied ? <Check size={13} className="text-emerald-700" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>
    </div>
  );
}
const th = `${GRID} bg-slate-100 px-3 py-2 text-left align-bottom text-xs font-semibold text-slate-700`;

/**
 * status = 서버 응답 { slots: [{slot, label, hint, file}], unmatched: [파일] } 또는 null(아직 모름)
 * folder = input.figureFolder, upload = { doneFiles, totalFiles } 또는 undefined
 */
export default function PsaFigures({ status, loading, error, folder, upload, onPick, onAddFiles, onRefresh, hasWorkspace }) {
  const slots = status?.slots || [];
  const missing = slots.filter(s => !s.file);
  const uploading = !!folder?.uploading;
  return (
    <ExcelDropZone onFiles={onAddFiles} disabled={uploading} message="놓으면 그림을 더합니다(같은 이름은 바꿈)">
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">그림 올리기: 여기로 끌어 놓기, 파일 여러 개 선택, 폴더 선택</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-700">
            그림 파일 이름을 <b>보고서 그림 제목 그대로</b> 붙인 폴더를 고르세요(아래 표의 '파일 이름', 확장자 png, jpg, bmp, gif).
            예: Piping & Instrument Diagram for Cargo System.png, Piping model for TD01.png. 앞에 'Figure 1.1' 같은 번호를 붙여도 되고 대소문자와 띄어쓰기는 보지 않습니다.
            <span className="mt-0.5 block">파일을 고르거나 끌어 놓으면 있던 그림에 더하고(같은 이름은 바꿈), 폴더를 고르면 그 폴더의 그림으로 모두 바꿉니다.</span>
            {folder?.name && <span className="mt-0.5 block font-semibold">지금 올라간 그림: {folder.name === '그림 파일' ? '' : `${folder.name}, `}파일 {folder.fileCount}개</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ExcelPickButton
            multiple
            accept=".png,.jpg,.jpeg,.bmp,.gif"
            onPick={onAddFiles}
            disabled={uploading}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-blue px-4 text-sm font-bold text-white hover:bg-brand-blue-dark disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
          >
            <ImagePlus size={15} aria-hidden="true" />
            {uploading ? `올리는 중 ${upload ? `${upload.doneFiles}/${upload.totalFiles}` : ''}` : '그림 파일 선택'}
          </ExcelPickButton>
          <FolderPickButton
            onPick={onPick}
            disabled={uploading}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
          >
            <FolderOpen size={15} aria-hidden="true" /> 폴더 선택
          </FolderPickButton>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <p
          role="status"
          className={`text-sm font-semibold ${error ? 'text-red-800' : loading || uploading ? 'text-blue-800' : missing.length ? 'text-amber-900' : 'text-emerald-800'}`}
        >
          {error ? `그림을 확인하지 못했습니다: ${error}`
            : loading || uploading ? '그림을 확인하는 중입니다.'
              : !status ? (hasWorkspace ? '그림 자리를 확인하려면 [다시 확인]을 누르세요.' : '입력을 시작하면 그림 자리가 나옵니다.')
                : missing.length ? `그림 ${slots.length}개 중 ${missing.length}개가 없습니다. 없는 그림은 보고서에 [ Figure not provided ] 로 찍힙니다.`
                  : `그림 ${slots.length}개가 모두 있습니다.`}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || !hasWorkspace}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} 다시 확인
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
        <table className="w-full table-fixed border-collapse border-hidden text-sm" style={{ minWidth: 680 }}>
          <colgroup><col style={{ width: 96 }} /><col /><col style={{ width: '32%' }} /></colgroup>
          <thead>
            <tr><th className={th}>보고서 자리</th><th className={th}>파일 이름 (보고서 제목 그대로, 확장자 제외)</th><th className={th}>찾은 파일</th></tr>
          </thead>
          <tbody>
            {slots.length === 0 && (
              <tr><td colSpan={3} className={`${GRID} px-3 py-3 text-slate-500`}>아직 그림 자리를 모릅니다.</td></tr>
            )}
            {slots.map(s => (
              <tr key={s.slot}>
                <th scope="row" className={`${GRID} px-3 py-1.5 text-left text-xs font-semibold text-slate-700`}>{slotName(s).number}</th>
                <td className={`${GRID} px-3 py-1.5`}><NameCell name={slotName(s).name} /></td>
                <td className={`${GRID} px-3 py-1.5`}>
                  {s.file ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700" title={s.file}>
                      <CheckCircle2 size={14} aria-hidden="true" /><span className="truncate">{s.file}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                      <XCircle size={14} aria-hidden="true" />없음
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {status?.unmatched?.length > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          자리를 못 찾은 그림 {status.unmatched.length}개: {status.unmatched.slice(0, 6).join(', ')}{status.unmatched.length > 6 ? ' …' : ''}. 이름을 표의 '파일 이름'(보고서 제목)으로 바꿔 다시 올리세요.
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        좌표계, Manifold 하중 방향, Stress range factor 그림은 사내 공통이라 서식 그림을 그대로 씁니다. Figure 2.1(Hogging and sagging)은 서식의 두 그림 자리를 그림 한 장으로 받습니다.
      </p>
    </section>
    </ExcelDropZone>
  );
}
