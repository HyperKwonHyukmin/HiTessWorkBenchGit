/**
 * @fileoverview 입력 CSV 미리보기 패널 — 탭 + 표 + 표시 행 수 안내.
 *
 * 순수 표시 컴포넌트다. 파일을 읽거나 API 를 부르지 않고, 부모가 이미 파싱해 넘긴
 * `tabs` 만 그린다. 덕분에 '내 파일'(브라우저 파싱)과 '사내 샘플'(서버 응답)을
 * 같은 표로 보여줄 수 있다.
 */
import React from 'react';
import { FileSpreadsheet, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

import FeedbackState from '../ui/FeedbackState';
import { sliceCsvPreview, EXPANDED_ROW_LIMIT } from '../../utils/csvPreview';

function TabButton({ active, label, count, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors border
        ${disabled
          ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'
          : active
            ? 'bg-blue-600 text-white border-blue-600 shadow-sm cursor-pointer'
            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300 cursor-pointer'}`}
    >
      {label}
      {count != null && (
        <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full
          ${active ? 'bg-blue-500/60 text-white' : 'bg-slate-100 text-slate-500'}`}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

/**
 * @param {object}   props
 * @param {Array}    props.tabs      [{ key, label, filename, rows, totalRows, truncated, loading, error }]
 * @param {string}   props.activeKey
 * @param {Function} props.onActiveKeyChange
 * @param {React.ReactNode} [props.headerRight]  헤더 우측 슬롯(모드 토글 등)
 * @param {string}   [props.emptyTitle]
 * @param {string}   [props.emptyMessage]
 * @param {React.ReactNode} [props.emptyAction]  빈 상태에서 보여줄 버튼 등
 */
export default function CsvPreviewPanel({
  tabs = [],
  activeKey,
  onActiveKeyChange,
  headerRight = null,
  emptyTitle = 'CSV 미리보기 대기 중',
  emptyMessage = 'CSV 파일을 올리면 내용을 표로 확인할 수 있습니다.',
  emptyAction = null,
}) {
  const [expanded, setExpanded] = React.useState(false);

  // tabs 는 항상 3종(stru/pipe/equip)을 다 담고 있으므로 activeKey 는 반드시 매칭된다.
  // 그래서 '고른 탭이 비었을 때' 를 따로 다뤄야 한다 — Piping 만 올린 사용자가
  // Structural 탭에 걸려 빈 화면을 보는 일을 막는다.
  const requested = tabs.find(t => t.key === activeKey);
  const requestedHasContent = !!(requested?.rows?.length || requested?.loading || requested?.error);
  const active = requestedHasContent
    ? requested
    : (tabs.find(t => t.rows?.length) ?? requested ?? tabs[0]);

  // 탭을 옮기면 '전체 보기' 는 다시 접는다 — 다른 파일까지 수천 행으로 펼쳐질 이유가 없다.
  React.useEffect(() => { setExpanded(false); }, [activeKey]);

  const { header, bodyRows, shownCount, hiddenCount } = sliceCsvPreview(active?.rows, expanded);
  const dataRowCount = Math.max((active?.totalRows ?? 0) - 1, 0);

  const renderBody = () => {
    if (!active) {
      return <FeedbackState icon={FileSpreadsheet} title={emptyTitle} message={emptyMessage}>{emptyAction}</FeedbackState>;
    }
    if (active.loading) {
      return <FeedbackState variant="loading" icon={Loader2} title="CSV를 읽는 중..." message={active.filename} />;
    }
    if (active.error) {
      return <FeedbackState variant="error" icon={AlertCircle} title="CSV를 읽지 못했습니다" message={active.error} />;
    }
    if (!active.rows || active.rows.length === 0) {
      return <FeedbackState icon={FileSpreadsheet} title={emptyTitle} message={emptyMessage}>{emptyAction}</FeedbackState>;
    }
    if (bodyRows.length === 0) {
      return (
        <FeedbackState
          icon={AlertCircle}
          title="데이터 행이 없습니다"
          message={`${active.filename ?? '이 파일'} 에는 헤더만 있고 데이터 행이 없습니다.`}
        />
      );
    }

    return (
      <div className="overflow-auto custom-scrollbar h-full">
        <table className="min-w-full text-left text-xs font-mono whitespace-nowrap border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 bg-slate-100 border-b border-r border-slate-200 px-2 py-1.5 text-[10px] font-sans font-bold text-slate-400 text-right">
                #
              </th>
              {header.map((h, i) => (
                <th
                  key={i}
                  className="bg-slate-100 border-b border-slate-200 px-3 py-1.5 text-[10px] font-sans font-bold text-slate-500 uppercase tracking-wider"
                >
                  {h || <span className="text-slate-300">(빈 컬럼)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, i) => (
              <tr key={i} className="hover:bg-blue-50/50">
                <td className="sticky left-0 z-10 bg-white border-b border-r border-slate-100 px-2 py-1 text-[10px] font-sans text-slate-300 text-right">
                  {i + 1}
                </td>
                {header.map((_, j) => (
                  <td key={j} className="border-b border-slate-100 px-3 py-1 text-slate-600">
                    {row[j] ?? <span className="text-slate-200">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 탭 + 헤더 우측 슬롯 */}
      <div className="flex items-center justify-between gap-3 flex-wrap shrink-0 pb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {tabs.map(tab => (
            <TabButton
              key={tab.key}
              active={tab.key === active?.key}
              label={tab.label}
              count={tab.rows?.length ? Math.max(tab.totalRows - 1, 0) : null}
              disabled={!tab.rows?.length && !tab.loading && !tab.error}
              onClick={() => onActiveKeyChange?.(tab.key)}
            />
          ))}
        </div>
        {headerRight}
      </div>

      {/* 파일명 + 표시 행 수 안내 */}
      {active?.rows?.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap shrink-0 mb-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
          <div className="flex items-center gap-1.5 min-w-0">
            <FileSpreadsheet size={12} className="text-slate-400 shrink-0" />
            <span className="text-[11px] font-medium text-slate-600 truncate" title={active.filename}>
              {active.filename}
            </span>
            <span className="text-[11px] text-slate-400 shrink-0">
              · {header.length}컬럼 · 전체 {dataRowCount.toLocaleString()}행
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hiddenCount > 0 && (
              <span className="text-[11px] text-amber-600 font-medium">
                상위 {shownCount.toLocaleString()}행만 표시
              </span>
            )}
            {(hiddenCount > 0 || expanded) && (
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                {expanded
                  ? <><ChevronUp size={12} /> 접기</>
                  : <><ChevronDown size={12} /> 전체 보기</>}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 표 */}
      <div className="flex-1 min-h-0 rounded-xl border border-slate-200 overflow-hidden bg-white">
        {renderBody()}
      </div>

      {/* 상한 안내 — 미리보기가 브라우저를 멈추게 두지 않는다는 사실을 알린다 */}
      {expanded && hiddenCount > 0 && (
        <p className="shrink-0 mt-1.5 text-[10px] text-slate-400 text-center">
          미리보기는 최대 {EXPANDED_ROW_LIMIT.toLocaleString()}행까지 표시합니다.
          전체 행 검증 결과는 실행 후 <span className="font-semibold text-slate-500">CSV 입력 검증</span>에서 확인하세요.
        </p>
      )}
      {active?.truncated && (
        <p className="shrink-0 mt-1.5 text-[10px] text-amber-500 text-center">
          파일이 매우 커서 앞부분만 읽었습니다.
        </p>
      )}
    </div>
  );
}
