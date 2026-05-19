/// <summary>
/// 가입자 전체 통계 상세 모달 — User Management 의 분포 통계 카드에서 진입.
/// 4개 섹션: 3대 분포 완전 목록 · 로그인 활동 분포 · 가입 추이 · 휴면 사용자.
/// </summary>
import React, { Fragment, useMemo } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  X, BarChart3, Building, Briefcase, Tag, Activity,
  Calendar, Moon, Award, TrendingUp, UserX,
} from 'lucide-react';

// ──────────────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;

const fmtPct = (num, denom) => (denom > 0 ? `${((num / denom) * 100).toFixed(1)}%` : '0.0%');

// '미입력' 항목은 정렬 결과와 무관하게 맨 뒤로 보낸다.
const sortDist = (entries) =>
  entries
    .slice()
    .sort((a, b) => {
      if (a[0] === '미입력') return 1;
      if (b[0] === '미입력') return -1;
      return b[1] - a[1];
    });

const makeStats = (users, key) =>
  sortDist(
    Object.entries(
      users.reduce((acc, u) => {
        const v = u[key] || '미입력';
        acc[v] = (acc[v] || 0) + 1;
        return acc;
      }, {})
    )
  );

// 로그인 횟수 버킷
const LOGIN_BUCKETS = [
  { key: '0',     label: '미로그인',   color: 'bg-slate-400',    text: 'text-slate-600',    test: (n) => n === 0 },
  { key: '1-5',   label: '1–5회',     color: 'bg-sky-400',      text: 'text-sky-700',      test: (n) => n >= 1 && n <= 5 },
  { key: '6-20',  label: '6–20회',    color: 'bg-blue-500',     text: 'text-blue-700',     test: (n) => n >= 6 && n <= 20 },
  { key: '21-50', label: '21–50회',   color: 'bg-indigo-500',   text: 'text-indigo-700',   test: (n) => n >= 21 && n <= 50 },
  { key: '50+',   label: '50회 초과', color: 'bg-violet-600',   text: 'text-violet-700',   test: (n) => n > 50 },
];

const DORMANT_DAYS = 30;

// ──────────────────────────────────────────────────────────────────
// 메인 모달
// ──────────────────────────────────────────────────────────────────
export default function UserStatisticsModal({ isOpen, onClose, users = [] }) {
  const total = users.length;

  // 3대 분포
  const companyStats    = useMemo(() => makeStats(users, 'company'),    [users]);
  const departmentStats = useMemo(() => makeStats(users, 'department'), [users]);
  const positionStats   = useMemo(() => makeStats(users, 'position'),   [users]);

  // 활성/관리자 KPI
  const activeCount  = useMemo(() => users.filter(u => u.is_active).length, [users]);
  const adminCount   = useMemo(() => users.filter(u => u.is_admin).length,  [users]);
  const pendingCount = total - activeCount;

  // 로그인 활동 분포
  const loginBuckets = useMemo(() => {
    const counts = LOGIN_BUCKETS.map(b => ({ ...b, count: 0 }));
    for (const u of users) {
      const n = u.login_count || 0;
      const hit = counts.find(b => b.test(n));
      if (hit) hit.count += 1;
    }
    return counts;
  }, [users]);

  // TOP 10 활발한 사용자
  const top10 = useMemo(
    () =>
      users
        .slice()
        .sort((a, b) => (b.login_count || 0) - (a.login_count || 0))
        .slice(0, 10),
    [users]
  );

  // 가입 추이 — 최근 12개월
  const signupTrend = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: `${d.getMonth() + 1}월`,
        year: d.getFullYear(),
        count: 0,
      });
    }
    const idx = (year, month) => months.findIndex(m => m.key === `${year}-${String(month + 1).padStart(2, '0')}`);
    for (const u of users) {
      if (!u.created_at) continue;
      const dt = new Date(u.created_at);
      const i = idx(dt.getFullYear(), dt.getMonth());
      if (i >= 0) months[i].count += 1;
    }
    const max = Math.max(1, ...months.map(m => m.count));
    return { months, max };
  }, [users]);

  const newIn30Days = useMemo(() => {
    const cutoff = Date.now() - 30 * DAY_MS;
    return users.filter(u => u.created_at && new Date(u.created_at).getTime() >= cutoff).length;
  }, [users]);

  // 휴면 사용자
  const dormant = useMemo(() => {
    const cutoff = Date.now() - DORMANT_DAYS * DAY_MS;
    const neverLogged = users.filter(u => !u.last_login && u.is_active);
    const stale = users
      .filter(u => u.last_login && new Date(u.last_login).getTime() < cutoff && u.is_active)
      .sort((a, b) => new Date(a.last_login).getTime() - new Date(b.last_login).getTime());
    return { neverLogged, stale };
  }, [users]);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-900/75 backdrop-blur-xl" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-start sm:items-center justify-center p-2 sm:p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300" enterFrom="opacity-0 scale-95 translate-y-4" enterTo="opacity-100 scale-100 translate-y-0"
              leave="ease-in duration-200" leaveFrom="opacity-100 scale-100 translate-y-0" leaveTo="opacity-0 scale-95 translate-y-4"
            >
              <Dialog.Panel className="w-full max-w-6xl rounded-2xl bg-white shadow-[0_25px_70px_-15px_rgba(0,37,84,0.45)] ring-1 ring-slate-900/5 border border-white/40 my-4 flex flex-col max-h-[92vh] overflow-hidden">

                {/* 헤더 */}
                <div className="relative overflow-hidden rounded-t-2xl bg-gradient-to-br from-brand-blue via-brand-blue-dark to-brand-blue-light px-6 py-5 text-white shrink-0">
                  <div className="pointer-events-none absolute -top-12 -right-10 h-40 w-40 rounded-full bg-brand-accent/20 blur-3xl" />
                  <div className="pointer-events-none absolute -bottom-16 right-24 h-32 w-32 rounded-full bg-blue-400/20 blur-2xl" />
                  <div className="relative flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm ring-1 ring-white/20">
                        <BarChart3 className="h-6 w-6 text-white" />
                      </div>
                      <div>
                        <Dialog.Title className="text-xl font-bold tracking-tight">가입자 통계 자세히 보기</Dialog.Title>
                        <p className="text-xs text-white/70 mt-0.5">
                          총 <span className="font-bold text-white">{total}</span>명 ·
                          활성 <span className="font-bold text-emerald-300">{activeCount}</span> ·
                          대기 <span className="font-bold text-amber-300">{pendingCount}</span> ·
                          관리자 <span className="font-bold text-red-300">{adminCount}</span>
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={onClose}
                      className="rounded-lg p-1.5 text-white/80 hover:text-white hover:bg-white/15 transition-colors"
                      aria-label="닫기"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>

                {/* 본문 — 스크롤 영역 */}
                <div className="overflow-y-auto p-6 space-y-6 bg-slate-50/60">

                  {/* 섹션 1 — 3대 분포 전체 목록 */}
                  <section>
                    <SectionHeader title="조직 분포" subtitle="회사·부서·직급별 전체 목록과 비율" />
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      <DistributionCard
                        title="회사별 분포"
                        icon={Building}
                        accent={{ text: 'text-blue-600',    bar: 'bg-blue-500' }}
                        data={companyStats}
                        total={total}
                      />
                      <DistributionCard
                        title="부서별 분포"
                        icon={Briefcase}
                        accent={{ text: 'text-violet-600', bar: 'bg-violet-500' }}
                        data={departmentStats}
                        total={total}
                      />
                      <DistributionCard
                        title="직급별 분포"
                        icon={Tag}
                        accent={{ text: 'text-emerald-600', bar: 'bg-emerald-500' }}
                        data={positionStats}
                        total={total}
                      />
                    </div>
                  </section>

                  {/* 섹션 2 — 로그인 활동 분포 */}
                  <section>
                    <SectionHeader title="로그인 활동" subtitle="로그인 횟수 분포 및 활발한 사용자 TOP 10" />
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {/* 버킷 분포 (좌) */}
                      <div className="lg:col-span-1 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                          <Activity className="h-4 w-4 text-sky-500" />
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">로그인 횟수 버킷</p>
                        </div>
                        <ul className="space-y-3">
                          {loginBuckets.map(b => (
                            <li key={b.key}>
                              <div className="flex justify-between items-center text-xs mb-1">
                                <span className={`font-bold ${b.text}`}>{b.label}</span>
                                <span className="text-slate-500 font-medium">
                                  {b.count}명 <span className="text-slate-400">· {fmtPct(b.count, total)}</span>
                                </span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-2">
                                <div
                                  className={`${b.color} h-2 rounded-full transition-all duration-500`}
                                  style={{ width: `${total > 0 ? (b.count / total) * 100 : 0}%` }}
                                />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* TOP 10 (우) */}
                      <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                          <Award className="h-4 w-4 text-amber-500" />
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">활발한 사용자 TOP 10</p>
                        </div>
                        {top10.length === 0 ? (
                          <p className="text-sm text-slate-400 py-4 text-center">로그인 이력이 있는 사용자가 없습니다.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-[11px] font-bold text-slate-400 uppercase border-b border-slate-200">
                                  <th className="text-left py-2 px-2 w-8">#</th>
                                  <th className="text-left py-2 px-2">이름</th>
                                  <th className="text-left py-2 px-2 hidden md:table-cell">부서</th>
                                  <th className="text-right py-2 px-2">로그인</th>
                                </tr>
                              </thead>
                              <tbody>
                                {top10.map((u, i) => (
                                  <tr key={u.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                                    <td className="py-2 px-2 text-slate-400 font-mono text-xs">{i + 1}</td>
                                    <td className="py-2 px-2">
                                      <div className="font-bold text-slate-700">{u.name}</div>
                                      <div className="text-[11px] text-slate-400 font-mono">{u.employee_id}</div>
                                    </td>
                                    <td className="py-2 px-2 hidden md:table-cell text-slate-600 text-xs">
                                      {u.department || <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className="py-2 px-2 text-right font-bold text-slate-700">
                                      {u.login_count || 0}<span className="text-slate-400 font-normal text-xs ml-0.5">회</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  {/* 섹션 3 — 가입 추이 */}
                  <section>
                    <SectionHeader title="가입 추이" subtitle={`최근 12개월 월별 신규 가입자 · 최근 30일 신규 ${newIn30Days}명`} />
                    <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
                      <div className="flex items-center gap-2 mb-4">
                        <TrendingUp className="h-4 w-4 text-emerald-500" />
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">월별 가입자</p>
                      </div>
                      <div className="flex items-end gap-2 h-40">
                        {signupTrend.months.map(m => {
                          const heightPct = (m.count / signupTrend.max) * 100;
                          return (
                            <div key={m.key} className="flex-1 flex flex-col items-center min-w-0 group">
                              <div className="text-[11px] font-bold text-slate-500 mb-1 h-4">
                                {m.count > 0 ? m.count : ''}
                              </div>
                              <div className="w-full bg-slate-100 rounded-md relative flex items-end" style={{ height: 'calc(100% - 2rem)' }}>
                                <div
                                  className="w-full bg-gradient-to-t from-brand-blue to-blue-400 rounded-md transition-all duration-500 group-hover:from-brand-blue-dark group-hover:to-brand-blue-light"
                                  style={{ height: `${heightPct}%`, minHeight: m.count > 0 ? '4px' : '0' }}
                                />
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1 font-medium truncate w-full text-center">
                                {m.label}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-100 pt-3">
                        <span><Calendar className="h-3 w-3 inline mr-1" />최근 12개월</span>
                        <span>최대 월간 가입자: <span className="font-bold text-slate-600">{signupTrend.max}명</span></span>
                      </div>
                    </div>
                  </section>

                  {/* 섹션 4 — 휴면 사용자 */}
                  <section>
                    <SectionHeader
                      title="휴면 사용자"
                      subtitle={`최근 ${DORMANT_DAYS}일 미로그인 ${dormant.stale.length}명 · 로그인 이력 없음 ${dormant.neverLogged.length}명`}
                    />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* 30일+ 미로그인 */}
                      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                          <Moon className="h-4 w-4 text-indigo-500" />
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{DORMANT_DAYS}일+ 미로그인</p>
                          <span className="ml-auto px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-full">
                            {dormant.stale.length}명
                          </span>
                        </div>
                        {dormant.stale.length === 0 ? (
                          <p className="text-sm text-slate-400 py-4 text-center">모든 사용자가 최근 활동 중입니다.</p>
                        ) : (
                          <ul className="max-h-64 overflow-y-auto -mx-1 px-1 space-y-1.5">
                            {dormant.stale.slice(0, 30).map(u => {
                              const days = Math.floor((Date.now() - new Date(u.last_login).getTime()) / DAY_MS);
                              return (
                                <li key={u.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 text-sm">
                                  <div className="min-w-0">
                                    <div className="font-bold text-slate-700 truncate">{u.name}</div>
                                    <div className="text-[11px] text-slate-400 font-mono">{u.employee_id} · {u.department || '미입력'}</div>
                                  </div>
                                  <span className="text-xs font-bold text-indigo-600 shrink-0 ml-2">{days}일 전</span>
                                </li>
                              );
                            })}
                            {dormant.stale.length > 30 && (
                              <li className="text-[11px] text-slate-400 text-center pt-2 border-t border-slate-100">
                                +{dormant.stale.length - 30}명 더
                              </li>
                            )}
                          </ul>
                        )}
                      </div>

                      {/* 로그인 이력 없음 */}
                      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                          <UserX className="h-4 w-4 text-rose-500" />
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">승인 후 미로그인</p>
                          <span className="ml-auto px-2 py-0.5 bg-rose-50 text-rose-700 text-xs font-bold rounded-full">
                            {dormant.neverLogged.length}명
                          </span>
                        </div>
                        {dormant.neverLogged.length === 0 ? (
                          <p className="text-sm text-slate-400 py-4 text-center">모든 승인 사용자가 한 번 이상 로그인했습니다.</p>
                        ) : (
                          <ul className="max-h-64 overflow-y-auto -mx-1 px-1 space-y-1.5">
                            {dormant.neverLogged.slice(0, 30).map(u => (
                              <li key={u.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 text-sm">
                                <div className="min-w-0">
                                  <div className="font-bold text-slate-700 truncate">{u.name}</div>
                                  <div className="text-[11px] text-slate-400 font-mono">{u.employee_id} · {u.department || '미입력'}</div>
                                </div>
                                <span className="text-xs font-bold text-rose-600 shrink-0 ml-2">미로그인</span>
                              </li>
                            ))}
                            {dormant.neverLogged.length > 30 && (
                              <li className="text-[11px] text-slate-400 text-center pt-2 border-t border-slate-100">
                                +{dormant.neverLogged.length - 30}명 더
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    </div>
                  </section>
                </div>

                {/* 푸터 */}
                <div className="px-6 py-3 border-t border-slate-200 bg-white flex justify-end shrink-0">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-sm transition-colors"
                  >
                    닫기
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

// ──────────────────────────────────────────────────────────────────
// 서브 컴포넌트
// ──────────────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }) {
  return (
    <div className="flex items-baseline gap-3 mb-3 px-1">
      <h4 className="text-sm font-extrabold text-slate-800 tracking-tight">{title}</h4>
      <span className="text-xs text-slate-500">{subtitle}</span>
    </div>
  );
}

function DistributionCard({ title, icon: Icon, accent, data, total }) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Icon className={`h-4 w-4 ${accent.text}`} />
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{title}</p>
        <span className="ml-auto text-[11px] text-slate-400 font-medium">{data.length}개 항목</span>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-slate-400 py-4 text-center">데이터 없음</p>
      ) : (
        <ul className="space-y-2.5 max-h-96 overflow-y-auto -mx-1 px-1">
          {data.map(([name, count]) => {
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <li key={name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-700 font-medium truncate max-w-[60%]" title={name}>{name}</span>
                  <span className="text-slate-500 font-medium">
                    <span className="text-slate-700 font-bold">{count}</span>명
                    <span className="text-slate-400 ml-1">· {pct.toFixed(1)}%</span>
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5">
                  <div
                    className={`${accent.bar} h-1.5 rounded-full transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
