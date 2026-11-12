import React, { useEffect, useState } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { ChevronRight, Copy, ExternalLink, Megaphone } from 'lucide-react';
import { copyUpdateLink, openUpdateInBrowser } from '../../../api/updates';
import { getUpdateStats } from '../../../api/reports';
import { fmtReach, unseenMailList, hasTargetList, personMeta, reachPct, groupEntriesByApp } from '../../../utils/newsletterStats';
import { DailyBars } from './StatBits';

/**
 * 업데이트 안내(/updates) 조회 통계(2026-11-12) — 뉴스레터 통계와 같은 사람만(서버가 {allowed:false} 면 숨김).
 * 표는 App 마다 최신 안내 한 줄(이전 안내는 그 줄 아래 펼쳐 보기 — 안내가 늘어도 표가 App 수로 묶인다, 2026-11-12 사용자 결정).
 * 핵심만: 안내마다 조회수, 앱 안에서 본 사람, 브라우저로 본 PC, 그 App 사용자 가운데 본 사람.
 * 줄을 고르면 그 App 사용자 명단(본 사람, 안 본 사람 — 안 본 사람 메일 복사)과 날짜별 조회. 안내 전후 실행 비교는 빼기로 함(사용자 결정 2026-11-12).
 * App 분류 = updates.json 의 programs(Analysis.program_name). 사람은 앱 안에서 연 기록으로만 안다(브라우저는 PC 만).
 */
export default function UpdateStatsPanel() {
  const [data, setData] = useState(null);
  const [entryId, setEntryId] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());   // 이전 안내를 펼친 App

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
  const groups = groupEntriesByApp(entries);
  const toggleApp = (app) => {
    const closing = expanded.has(app);
    setExpanded(prev => {
      const next = new Set(prev);
      if (closing) next.delete(app); else next.add(app);
      return next;
    });
    // 접을 때 그 App 의 이전 안내를 보고 있었으면 최신 줄로 옮긴다 — 숨은 줄의 상세가 아래에 남지 않게(리뷰 반영)
    const g = groups.find(x => x.app === app);
    if (closing && g?.older.some(o => o.entry === entryId)) setEntryId(g.latest.entry);
  };

  // 한 줄 — 최신 안내 줄에는 '이 App 의 이전 안내 N건' 펼치기, 이전 안내(nested)는 들여쓰고 바탕을 옅게
  const renderRow = (e, { nested = false, olderCount = 0, open = false } = {}) => {
    const active = e.entry === entryId;
    const rp = reachPct(e.appEffect);
    return (
                    <tr key={e.entry} onClick={() => setEntryId(e.entry)}
                      className={`border-t border-slate-100 cursor-pointer ${active ? 'bg-blue-50' : nested ? 'bg-slate-50/60 hover:bg-slate-50' : 'hover:bg-slate-50'}`}>
                      <td className={`py-2 pr-3 ${nested ? 'pl-8' : 'pl-3'}`}>
                        <button type="button" onClick={() => setEntryId(e.entry)} aria-pressed={active}
                          className="block rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                          <span className="block font-medium text-slate-800">{e.title}</span>
                          <span className="block text-[11px] text-slate-500">{e.date}{e.app ? `  ${e.app}` : ''}</span>
                        </button>
                        {olderCount > 0 && (
                          <button type="button" aria-expanded={open}
                            onClick={(ev) => { ev.stopPropagation(); toggleApp(e.app || '기타'); }}
                            className="mt-1 inline-flex items-center gap-0.5 rounded text-[11px] font-medium text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                            <ChevronRight size={12} className={open ? 'rotate-90' : ''} aria-hidden="true" />
                            이 App 의 이전 안내 {olderCount}건
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {e.appEffect ? (
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-24 shrink-0 rounded bg-slate-200" aria-hidden="true">
                              <span className="block h-full rounded bg-blue-600" style={{ width: `${rp ?? 0}%` }} />
                            </span>
                            <span className="tabular-nums text-sm font-bold text-slate-800">{rp == null ? '-' : `${rp}%`}</span>
                            <span className="tabular-nums text-xs text-slate-500">{rp == null ? fmtReach(e.appEffect) : `${e.appEffect.viewedTargets} / ${e.appEffect.targetUsers}명`}</span>
                          </div>
                        ) : <span className="text-xs text-slate-400">App 분류 없음</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs tabular-nums text-slate-600">
                        {e.views}회 <span className="text-slate-400">(앱 안 {e.people}명, 브라우저 {e.browserVisitors}곳)</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right" onClick={(ev) => ev.stopPropagation()}>
                        <PageLinkButtons entryId={e.entry} />
                      </td>
                    </tr>
    );
  };

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
                  <th className="px-3 py-2 text-left font-bold w-64" title="그 App 을 한 번이라도 실행한 사람(User Management 'App 사용자' 필터와 같은 사람들) 가운데 앱 안에서 안내를 연 사람">App 사용자 중 본 사람</th>
                  <th className="px-3 py-2 text-left font-bold" title="조회 = 열람 수(새로고침 포함), 앱 안 = 앱에서 연 사람, 브라우저 = 메일 링크 등으로 연 PC">조회</th>
                  <th className="px-3 py-2 text-right font-bold">페이지</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const open = expanded.has(g.app);
                  return (
                    <React.Fragment key={g.app}>
                      {renderRow(g.latest, { olderCount: g.older.length, open })}
                      {open && g.older.map(o => renderRow(o, { nested: true }))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="border-t border-slate-100 pt-5 space-y-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h4 className="text-sm font-bold text-slate-800">{selected.title}</h4>
                <span className="text-xs text-slate-500">
                  {selected.daily?.length
                    ? `조회 ${selected.views}회, 마지막 ${selected.daily[selected.daily.length - 1].day.slice(5)}`
                    : '아직 조회가 없습니다'}
                </span>
              </div>
              {selected.daily?.length > 0 && (
                <div className="max-w-xl"><DailyBars daily={selected.daily} /></div>
              )}
              {hasTargetList(effect) && <TargetUsers effect={effect} appLabel={selected.app || effect.programs.join(', ')} />}
              {!effect && (
                <p className="text-xs text-slate-500">이 안내에는 App 분류(updates.json 의 programs)가 없어 사용자 명단을 셀 수 없습니다.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** 안내 페이지 주소 복사와 열기(시스템 브라우저 — 메일 받은 사람이 보는 그 페이지). */
function PageLinkButtons({ entryId }) {
  const { showToast } = useToast();
  const copy = async () => {
    const url = await copyUpdateLink(entryId);
    if (url) showToast(`안내 주소를 복사했습니다: ${url}`, 'success');
    else showToast('복사하지 못했습니다.', 'error');
  };
  const btn = 'inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50';
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={copy} className={btn} title="안내 주소 복사(메일, 메신저용)">
        <Copy size={12} aria-hidden="true" /> 복사
      </button>
      <button type="button" onClick={() => openUpdateInBrowser(entryId)} className={btn} title="브라우저로 안내 페이지 열기">
        <ExternalLink size={12} aria-hidden="true" /> 열기
      </button>
    </span>
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
          대상 = {appLabel} 사용자 {effect.targetUsers}명 가운데 본 사람 {effect.viewedTargets}명
          {effect.otherViewers > 0 && <span className="font-normal text-slate-500"> (그 밖에 앱 안에서 본 사람 {effect.otherViewers}명)</span>}
        </h4>
        <div className="flex items-center gap-1">
          {[['unseen', `안 본 사람 ${unseen.length}`], ['seen', `본 사람 ${seen.length}`]].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
              className={`rounded-md px-2.5 py-1 text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${tab === key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
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
                {personMeta(t) && <span className="text-slate-500"> {personMeta(t)}</span>}
              </span>
              {t.seenDay && <span className="shrink-0 tabular-nums text-slate-500">{t.seenDay.slice(5)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
