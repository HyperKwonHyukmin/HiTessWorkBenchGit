/// <summary>
/// User Management 'PC 등록' — 회사 도메인에 없는 계열사 PC 의 등록 요청을 승인·거절하고, 승인된 PC 를 해지한다(2026-11-10).
/// 승인은 직원이 로그인 화면에서 불러 준 확인 코드를 적어야 된다(서버가 대조 — 남의 사번으로 보낸 요청을 거르는 단계).
/// 서버 routers/device_login.py.
/// </summary>
import React, { Fragment, useCallback, useEffect, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { Laptop, X, Loader2, RefreshCw } from 'lucide-react';
import { getTrustedDevices, decideTrustedDevice } from '../../api/admin';

const STATUS_LABEL = {
  pending: { text: '승인 대기', cls: 'bg-amber-100 text-amber-800' },
  approved: { text: '승인됨', cls: 'bg-emerald-100 text-emerald-800' },
  rejected: { text: '거절', cls: 'bg-slate-100 text-slate-600' },
  revoked: { text: '해지', cls: 'bg-slate-100 text-slate-600' },
};

const ERROR_TEXT = {
  confirm_code_mismatch: '확인 코드가 맞지 않습니다. 직원 화면의 코드를 다시 물어보세요.',
};

const fmt = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : '-');

export default function TrustedDevicesModal({ isOpen, onClose, onChanged, showToast }) {
  const [items, setItems] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [codes, setCodes] = useState({}); // {id: 입력한 확인 코드}

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getTrustedDevices(showAll ? 'all' : undefined);
      setItems(data.items || []);
    } catch {
      showToast('PC 등록 목록을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showAll, showToast]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const decide = async (row, action) => {
    if (busyId) return;
    if (action === 'approve' && !(codes[row.id] || '').trim()) {
      showToast('직원 화면에 보이는 확인 코드를 먼저 적으세요.', 'warning');
      return;
    }
    setBusyId(row.id);
    try {
      await decideTrustedDevice(row.id, action, codes[row.id]);
      const done = { approve: '승인했습니다. 직원 화면이 15초 안에 저절로 들어갑니다.', reject: '거절했습니다.', revoke: '해지했습니다. 그 PC 는 다음 로그인부터 막힙니다.' };
      showToast(`${row.name || row.employee_id} · ${row.hostname || 'PC'} — ${done[action]}`, 'success');
      setCodes(prev => { const next = { ...prev }; delete next[row.id]; return next; });
      await load();
      onChanged?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      showToast(ERROR_TEXT[detail] || `처리하지 못했습니다(${detail || err?.response?.status || '연결 실패'}).`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Transition appear show={!!isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => { if (!busyId) onClose(); }}>
        <TransitionChild as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
        </TransitionChild>
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <TransitionChild as={Fragment}
            enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
            leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
            <DialogPanel className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div className="flex items-center gap-2">
                  <Laptop size={18} className="text-brand-blue" aria-hidden="true" />
                  <DialogTitle className="text-base font-bold text-slate-800">PC 등록</DialogTitle>
                  <span className="text-xs text-slate-500">회사 도메인에 없는 PC(계열사)의 비밀번호 없는 로그인</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
                    거절·해지 포함
                  </label>
                  <button type="button" onClick={load} disabled={loading} aria-label="새로 고침"
                    className="cursor-pointer rounded-lg p-1 text-slate-500 hover:text-slate-700 disabled:cursor-wait">
                    <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                  </button>
                  <button type="button" onClick={onClose} disabled={!!busyId} aria-label="닫기"
                    className="cursor-pointer rounded-lg p-1 text-slate-500 transition-colors hover:text-slate-700 disabled:cursor-wait">
                    <X size={16} />
                  </button>
                </div>
              </div>

              <p className="border-b border-slate-100 px-5 py-3 text-sm text-slate-600">
                대부분은 직원이 회사 메일로 받은 코드를 입력해 <b>저절로 승인</b>됩니다. 회사 메일이 없거나 발송에 실패한 요청만 여기서 승인하세요.
                승인하기 전에 <b>관리자가 이미 아는 연락처</b>(사내 메신저·부서 전화)로 그 직원에게 <b>먼저</b> 연락해
                로그인 화면의 <b>확인 코드</b>를 물어 칸에 적으세요. 코드가 같아야 승인됩니다. 모르는 사람이 먼저 걸어 온
                연락의 코드로는 승인하지 마세요. PC 이름·Windows 계정은 앱이 알려 준 값이라 참고만 하세요.
              </p>

              <div className="flex-1 overflow-y-auto">
                {loading && items.length === 0 ? (
                  <p className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> 불러오는 중</p>
                ) : items.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-slate-500">등록 요청이 없습니다.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs font-bold text-slate-600">
                      <tr>
                        <th className="px-5 py-2">사람</th>
                        <th className="px-3 py-2">PC</th>
                        <th className="px-3 py-2">상태</th>
                        <th className="px-3 py-2">요청 · 마지막 사용</th>
                        <th className="px-3 py-2 w-[30%]">처리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(row => {
                        const label = STATUS_LABEL[row.status] || { text: row.status, cls: 'bg-slate-100 text-slate-600' };
                        const busy = busyId === row.id;
                        return (
                          <tr key={row.id} className="border-t border-slate-100 align-top">
                            <td className="px-5 py-2.5">
                              <div className="font-bold text-slate-800">{row.name || '-'} <span className="font-mono text-xs font-normal text-slate-500">{row.employee_id}</span></div>
                              <div className="text-xs text-slate-500">{[row.company, row.department].filter(Boolean).join(' · ') || '-'}</div>
                            </td>
                            <td className="px-3 py-2.5 text-xs text-slate-600">
                              <div className="font-mono">{row.hostname || '-'}</div>
                              <div className="text-slate-500">계정 {row.os_user || '-'} · {row.ip_address || '-'}</div>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${label.cls}`}>{label.text}</span>
                              {row.status === 'pending' && row.verify === 'email' && (
                                <div className="mt-1 text-xs text-slate-500">직원이 메일 코드로 확인 중</div>
                              )}
                              {row.status === 'approved' && row.decided_by === 'email' && (
                                <div className="mt-1 text-xs text-slate-500">메일 코드로 확인</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-slate-600">
                              <div>{fmt(row.requested_at)}</div>
                              <div className="text-slate-500">{row.last_used_at ? `사용 ${fmt(row.last_used_at)} · ${row.use_count}회` : '사용 전'}</div>
                            </td>
                            <td className="px-3 py-2.5">
                              {row.status === 'pending' && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={codes[row.id] || ''}
                                    onChange={e => setCodes(prev => ({ ...prev, [row.id]: e.target.value }))}
                                    onKeyDown={e => {
                                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                                      if (e.key === 'Enter') decide(row, 'approve');
                                    }}
                                    placeholder="확인 코드"
                                    aria-label={`${row.name || row.employee_id} 확인 코드`}
                                    spellCheck={false}
                                    autoComplete="off"
                                    disabled={busy}
                                    className="w-28 rounded-lg border border-slate-300 px-2 py-1 font-mono text-sm uppercase tracking-wider text-slate-800 outline-none focus:border-brand-blue"
                                  />
                                  <button type="button" onClick={() => decide(row, 'approve')} disabled={busy}
                                    className="cursor-pointer rounded-lg bg-brand-blue px-2.5 py-1 text-xs font-bold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
                                    승인
                                  </button>
                                  <button type="button" onClick={() => decide(row, 'reject')} disabled={busy}
                                    className="cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-wait">
                                    거절
                                  </button>
                                </div>
                              )}
                              {row.status === 'approved' && (
                                <button type="button" onClick={() => decide(row, 'revoke')} disabled={busy}
                                  className="cursor-pointer rounded-lg border border-red-200 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-wait">
                                  해지
                                </button>
                              )}
                              {(row.status === 'rejected' || row.status === 'revoked') && (
                                <span className="text-xs text-slate-500">{fmt(row.decided_at)} · {row.decided_by === 'expired' ? '오래 안 써 만료' : row.decided_by || '-'}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
