import React, { useEffect, useState } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { Megaphone } from 'lucide-react';
import { getUpdateStats } from '../../../api/reports';
import { fmtReach, unseenMailList, hasTargetList } from '../../../utils/newsletterStats';
import { DailyBars } from './StatBits';

/**
 * 업데이트 안내(/updates) 조회 통계(2026-11-12) — 뉴스레터 통계와 같은 사람만(서버가 {allowed:false} 면 숨김).
 * 핵심만: 안내마다 조회수, 앱 안에서 본 사람, 브라우저로 본 PC, 그 App 사용자 가운데 본 사람.
 * 줄을 고르면 그 App 사용자 명단(본 사람, 안 본 사람 — 안 본 사람 메일 복사)과 날짜별 조회. 안내 전후 실행 비교는 빼기로 함(사용자 결정 2026-11-12).
 * App 분류 = updates.json 의 programs(Analysis.program_name). 사람은 앱 안에서 연 기록으로만 안다(브라우저는 PC 만).
 */
export default function UpdateStatsPanel() {
  const [data, setData] = useState(null);
  const [entryId, setEntryId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    getUpdateStats({ signal: controller.signal })
      .then(res => {
        if (!res.data?.allowed) { setData(null); return; }
        setData(res.data);
        setEntryId(res.data?.entries?.[0]?.entry ?? null);
      })
      .catch(() => setData(null));   // 옛 서버(404)·네트워크 — 조용히 숨긴다
    return () => controller.abort();
  }, []);

  if (!data) return null;
  const entries = data.entries || [];
  const selected = entries.find(e => e.entry === entryId);
  const effect = selected?.appEffect;

  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Megaphone size={16} className="text-blue-600" aria-hidden="true" /> 업데이트 안내
        </h3>
      </div>

      {entries.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">아직 안내가 없습니다.</p>
      ) : (
        <div className="p-5 space-y-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">안내</th>
                  <th className="px-3 py-2 text-right font-bold">조회</th>
                  <th className="px-3 py-2 text-right font-bold" title="WorkBench 앱 안에서 연 사람(사번 기준)">앱 안 (명)</th>
                  <th className="px-3 py-2 text-right font-bold" title="메일 링크 등 브라우저로 연 PC(IP 기준)">브라우저 (PC)</th>
                  <th className="px-3 py-2 text-right font-bold" title="그 App 을 한 번이라도 실행한 사람(User Management 'App 사용자' 필터와 같은 사람들) 가운데 앱 안에서 안내를 연 사람">App 사용자 중 본 사람</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  const active = e.entry === entryId;
                  return (
                    <tr key={e.entry} onClick={() => setEntryId(e.entry)}
                      className={`border-t border-slate-100 cursor-pointer ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setEntryId(e.entry)} aria-pressed={active}
                          className="text-left">
                          <span className="block font-medium text-slate-800">{e.title}</span>
                          <span className="block text-[11px] text-slate-500">{e.date}{e.app ? `  ${e.app}` : ''}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{e.views}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{e.people}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{e.browserVisitors}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{e.appEffect ? fmtReach(e.appEffect) : <span className="text-slate-400">App 분류 없음</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected && hasTargetList(effect) && <TargetUsers effect={effect} appLabel={selected.app || effect.programs.join(', ')} />}

          {selected && !effect && (
            <p className="text-xs text-slate-500">이 안내에는 App 분류(updates.json 의 programs)가 없어 사용자 명단을 셀 수 없습니다.</p>
          )}

          {selected && (
            <div className="max-w-xl">
              <h4 className="text-xs font-bold text-slate-600 mb-2">날짜별 조회 <span className="font-normal text-slate-500">({selected.title})</span></h4>
              <DailyBars daily={selected.daily} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TargetUsers({ effect, appLabel }) {
  const { showToast } = useToast();
  const [tab, setTab] = useState('unseen');
  const seen = effect.targets.filter(t => t.seenDay);
  const unseen = effect.targets.filter(t => !t.seenDay);
  const rows = tab === 'seen' ? seen : unseen;

  const copyUnseen = async () => {
    const { text, count, missing } = unseenMailList(effect.targets);
    if (!count) { showToast('메일 주소가 있는 안 본 사람이 없습니다.', 'info'); return; }
    try {
      await navigator.clipboard.writeText(text);
      showToast(`안 본 ${count}명의 메일을 복사했습니다. Outlook 숨은 참조에 붙여 넣으세요.${missing.length ? ` 주소 없음: ${missing.join(', ')}` : ''}`, 'success');
    } catch {
      showToast('복사하지 못했습니다.', 'error');
    }
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-slate-600">
          {appLabel} 사용자 {effect.targetUsers}명 가운데 본 사람 {effect.viewedTargets}명
          {effect.otherViewers > 0 && <span className="font-normal text-slate-500"> (그 밖에 앱 안에서 본 사람 {effect.otherViewers}명)</span>}
        </h4>
        <div className="flex items-center gap-1">
          {[['unseen', `안 본 사람 ${unseen.length}`], ['seen', `본 사람 ${seen.length}`]].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
              className={`rounded-md px-2.5 py-1 text-xs font-bold ${tab === key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {label}
            </button>
          ))}
          {tab === 'unseen' && unseen.length > 0 && (
            <button type="button" onClick={copyUnseen}
              className="ml-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
              메일 주소 복사
            </button>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">{tab === 'seen' ? '아직 본 사람이 없습니다.' : '모두 봤습니다.'}</p>
      ) : (
        <ul className="grid max-h-64 grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(t => (
            <li key={t.employeeId} className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-1.5 text-xs">
              <span className="min-w-0 truncate">
                <span className="font-medium text-slate-800">{t.name}</span>
                <span className="text-slate-500"> {[t.position, t.department].filter(Boolean).join(', ')}</span>
              </span>
              {t.seenDay && <span className="shrink-0 tabular-nums text-slate-500">{t.seenDay.slice(5)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
