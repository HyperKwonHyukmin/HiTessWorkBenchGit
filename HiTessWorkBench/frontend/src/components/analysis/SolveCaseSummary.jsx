/**
 * SolveCaseSummary — Drawing to Analysis 결과 화면 맨 위: 결과 머리 + 케이스별 최대 응력 표.
 *
 * 2026-11-16 사용자 지적('결과 페이지 가독성이 떨어지고 불편, 첫 화면에서 응력이 먼저'):
 *   - 케이스마다 최대 von Mises 와 그 요소, 최대 변위와 그 절점을 한 줄로. 가장 큰 응력 줄에 '지배' 글자.
 *   - 줄을 누르면 3D 색과 아래 값 표가 그 케이스로 바뀐다(예전 SUBCASE #1 고르기를 대신함).
 *   - 3D 색 [응력 | 변위] 전환. 응력이 기본.
 * 판정 기준(허용 응력)은 아직 정하지 않아(D4) 판정 칸은 두지 않는다 — 수계산 UC 는 왼쪽 패널.
 */
import { Download } from 'lucide-react';
import { governingCase } from '../../utils/solveResultSummary';

const fmt = (v, d) => (v == null ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));

export default function SolveCaseSummary({
  rows = [],          // summarizeSubcases 결과
  labels = [],        // 케이스 이름(같은 순서)
  selected = 0,
  onSelect,
  field = 'vm',
  onField,
  stale = false,      // 결과가 지금 입력값과 다름
  downloads = [],     // [[label, onClick]]
  onFocusElement,     // (elementId) => void — 최대 응력 요소를 3D 에서 보기
}) {
  const gov = governingCase(rows);
  const govRow = gov >= 0 ? rows[gov] : null;

  return (
    <div className="shrink-0 border-b border-slate-200">
      <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold text-slate-900">해석 결과 <span className="font-normal text-slate-500">하중 케이스 {rows.length}개</span></h2>
          {govRow && (
            <p className={`text-[12px] ${stale ? 'text-amber-800' : 'text-slate-600'}`}>
              최대 응력 <span className="font-semibold text-slate-900 tabular-nums">{fmt(govRow.maxVm, 1)} MPa</span>
              {' '}({labels[gov]}, E{govRow.maxVmElem})
              {stale && ', 바꾸기 전 값의 결과'}
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div role="radiogroup" aria-label="3D 색" className="inline-flex items-center gap-1.5">
            <span className="text-[12px] text-slate-500">3D 색</span>
            <span className="inline-flex p-0.5 rounded-lg bg-slate-100 text-[12px] font-semibold">
              {[['vm', '응력'], ['disp', '변위']].map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={field === k} onClick={() => onField?.(k)}
                  className={`px-3 h-7 rounded-md transition-colors ${field === k ? 'bg-white text-[#002554] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                  {label}
                </button>
              ))}
            </span>
          </div>
          {downloads.map(([label, onClick]) => (
            <button key={label} type="button" onClick={onClick}
              className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 h-7 text-[12px] text-slate-700 hover:bg-slate-50">
              <Download size={13} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-3 overflow-x-auto">
        <table className="w-auto min-w-[560px] text-[12px] border-collapse">
          <thead>
            <tr className="text-slate-500">
              <th scope="col" className="py-1 pr-3 text-left font-semibold">하중 케이스</th>
              <th scope="col" className="py-1 px-3 text-right font-semibold">최대 응력 (MPa)</th>
              <th scope="col" className="py-1 px-3 text-left font-semibold">요소</th>
              <th scope="col" className="py-1 px-3 text-right font-semibold">최대 변위 (mm)</th>
              <th scope="col" className="py-1 pl-3 text-left font-semibold">절점</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const on = i === selected;
              return (
                <tr key={i} onClick={() => onSelect?.(i)} aria-selected={on}
                  className={`cursor-pointer border-t border-slate-100 ${on ? 'bg-[#002554]/[0.06]' : 'hover:bg-slate-50'}`}>
                  <td className="py-1.5 pr-3">
                    <button type="button" onClick={(e) => { e.stopPropagation(); onSelect?.(i); }}
                      className={`text-left ${on ? 'font-semibold text-[#002554]' : 'text-slate-800'} focus-visible:underline outline-none`}>
                      {labels[i]}
                    </button>
                    {i === gov && rows.length > 1 && <span className="ml-2 text-[11px] font-semibold text-amber-800">지배</span>}
                  </td>
                  <td className={`py-1.5 px-3 text-right tabular-nums ${i === gov ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{fmt(r.maxVm, 1)}</td>
                  <td className="py-1.5 px-3 tabular-nums">
                    {r.maxVmElem != null ? (
                      <button
                        type="button"
                        title="3D 에서 이 요소 보기"
                        onClick={(e) => { e.stopPropagation(); onSelect?.(i); onFocusElement?.(r.maxVmElem); }}
                        className="text-[#002554] underline underline-offset-2 decoration-slate-300 hover:decoration-[#002554]"
                      >
                        E{r.maxVmElem}
                      </button>
                    ) : '—'}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{fmt(r.maxU, 3)}</td>
                  <td className="py-1.5 pl-3 text-slate-500 tabular-nums">{r.maxUNode != null ? `N${r.maxUNode}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
