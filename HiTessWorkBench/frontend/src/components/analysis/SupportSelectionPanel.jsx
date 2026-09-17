import React from 'react';
import { Crosshair, Trash2, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';

/**
 * 지지점(경계조건) 지정 패널 — 2단계 배치 도크 옆에 붙는다.
 *
 * 왜 수동인가: 자동 접촉 탐지는 최저 Z 에서 허용오차 안에 드는 절점을 세는데,
 * 밑면이 평평하지 않은 모듈에서는 **가장 낮은 레일 한 줄**만 잡힌다.
 * 실측(3521): 5개 절점이 전부 Y=-19099 한 직선 위였고, 11.8m 짜리 모듈이 그 선을
 * 축으로 넘어가는 모델이 되어 사용률 10배가 나왔다.
 * 실제 지지는 "높이가 다른 스툴을 어디에 놓을까"라는 설계 결정이라 형상에서 유도할 수 없다.
 */

const LEVEL_STYLE = {
  block: { box: 'border-red-200 bg-red-50', text: 'text-red-700', Icon: AlertTriangle },
  warn:  { box: 'border-amber-200 bg-amber-50', text: 'text-amber-800', Icon: AlertTriangle },
  info:  { box: 'border-slate-200 bg-slate-50', text: 'text-slate-600', Icon: Info },
};

export default function SupportSelectionPanel({
  onOpenPicker, count, evaluation, onClear, disabled,
}) {
  const m2 = (mm2) => (mm2 / 1.0e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
  // 지정 전에는 3단계가 막혀 있다 — 어디를 눌러야 풀리는지 한눈에 보여야 한다.
  const needsAttention = !disabled && count === 0;

  return (
    // ⚠ shrink-0 필수. 이 패널은 2단계의 세로 flex 기둥(카드 · 이 패널 · ArrangementPanel)
    //   안에 있는데, 페이지 루트가 xl(≥1280px)에서 `h-full` 이라 그 기둥의 높이가 화면에
    //   **고정**된다. 뷰어 카드는 `flex-1`(basis 0 → 줄어들 몫이 0) + `min-h-[440px]`,
    //   ArrangementPanel 은 `shrink-0` 이라, 높이가 모자라면 **줄어들 수 있는 것이 이 패널뿐**이다.
    //   게다가 루트에 `overflow-hidden` 이 있어 flex 자동 최소 높이가 0 이 되므로
    //   (CSS Flexbox: overflow 가 visible 이 아니면 min-height:auto → 0) 0px 까지 눌린다.
    //   실측(동일 구조 재현): 1920×1080 121px(정상) / 1600×900 55px(버튼 잘림)
    //   / 1366×768·1280×720(1920 @150% 배율)·1280×800(1600 @125%) **2px = 사실상 사라짐**.
    //   xl 미만에서는 루트가 `min-h-full` 이라 페이지가 늘어나 스크롤되므로 멀쩡했다.
    <div className={`shrink-0 rounded-2xl border bg-white overflow-hidden transition-colors
                     ${needsAttention
                       ? 'border-emerald-400 shadow-md shadow-emerald-500/10'
                       : 'border-slate-200 shadow-sm'}`}>
      <div className={`flex items-center justify-between gap-2 px-3 py-2 border-b
                       ${needsAttention ? 'border-emerald-100 bg-emerald-50/60' : 'border-slate-100 bg-slate-50/70'}`}>
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">지지점 지정</span>
          <span className="text-[9px] text-slate-400 truncate">
            스툴을 놓을 절점을 직접 고릅니다 · 발밑 적치면 절점에 RBE2 로 연결
          </span>
        </div>
        {count > 0 && (
          <button
            onClick={onClear}
            title="선택 전체 지우기"
            className="flex items-center gap-1 shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md
                       text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
          >
            <Trash2 size={10} /> 지우기
          </button>
        )}
      </div>

      <div className="p-3 flex flex-wrap items-start gap-3">
        <div className="relative shrink-0">
          {/* 퍼져 나가는 고리 — 정지 화면에서도 눈이 먼저 가는 유일한 요소가 되게 한다. */}
          {needsAttention && (
            <span className="absolute inset-0 rounded-xl bg-emerald-400 opacity-70 animate-ping pointer-events-none" />
          )}
          <button
            onClick={onOpenPicker}
            disabled={disabled}
            title="Module Unit 만 띄운 창에서 지지점을 고릅니다(정반이 밑면을 가리지 않습니다)."
            className={`relative flex items-center gap-1.5 rounded-xl text-xs font-bold
                        bg-emerald-600 hover:bg-emerald-700 text-white
                        transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
                        ${needsAttention
                          ? 'px-4 py-2.5 text-[13px] shadow-lg shadow-emerald-500/40 ring-2 ring-emerald-300'
                          : 'px-3 py-2 shadow-sm'}`}
          >
            <Crosshair size={needsAttention ? 15 : 13} />
            {count > 0 ? '지지점 다시 지정' : '지지점 지정하기'}
          </button>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <Stat label="지지점" value={`${count.toLocaleString()}개`} strong />
          {count > 0 && (
            <>
              <Stat label="지지 면적" value={`${m2(evaluation.hullAreaMm2)} m²`} />
              <Stat
                label="지지 범위"
                value={`${Math.round(evaluation.spanMm[0]).toLocaleString()} × ${Math.round(evaluation.spanMm[1]).toLocaleString()} mm`}
              />
            </>
          )}
        </div>

        <div className="flex-1 min-w-[260px] space-y-1">
          {count === 0 && (
            <div className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5">
              <AlertTriangle size={12} className="mt-px shrink-0 text-amber-600" />
              <p className="text-[10px] leading-relaxed text-amber-800">
                <b>3단계로 넘어가려면 지지점을 지정해야 합니다.</b> 자동 접촉 탐지는 최저 Z 만 보기 때문에,
                밑면이 평평하지 않은 모듈에서는 가장 낮은 레일 한 줄만 잡아 해석이 무의미해집니다.
              </p>
            </div>
          )}
          {count > 0 && evaluation.issues.length === 0 && (
            <div className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
              <CheckCircle2 size={12} className="mt-px shrink-0 text-emerald-600" />
              <p className="text-[10px] leading-relaxed text-emerald-800">
                지지점이 넓게 퍼져 있고 무게중심이 지지 다각형 안에 있습니다.
              </p>
            </div>
          )}
          {/* count 0 은 위 안내 배너가 이미 말했다 — 같은 말을 두 번 하지 않는다. */}
          {evaluation.issues.filter(i => i.code !== 'EMPTY').map((issue) => {
            const st = LEVEL_STYLE[issue.level] || LEVEL_STYLE.info;
            return (
              <div key={issue.code} className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 ${st.box}`}>
                <st.Icon size={12} className={`mt-px shrink-0 ${st.text}`} />
                <p className={`text-[10px] leading-relaxed ${st.text}`}>{issue.message}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, strong }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] text-slate-400 truncate">{label}</p>
      <p className={`text-[11px] font-mono truncate ${strong ? 'font-bold text-emerald-600' : 'text-slate-700'}`}>
        {value}
      </p>
    </div>
  );
}
