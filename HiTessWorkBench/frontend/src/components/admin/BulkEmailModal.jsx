/// <summary>
/// User Management '메일 한 번에 넣기' — PLM 에서 메일을 못 찾은 승인 사용자만 모아 보여 주고,
/// 아는 사람의 메일을 칸에 적어 한 번에 저장한다(2026-11-09 사용자 요청: 목록에서 일일이 찾지 않게).
/// 저장은 사람마다 PUT /api/users/{id} {email} — 서버가 email_manual 을 세워 PLM 갱신이 덮지 않는다.
/// 빈 칸은 건너뛰고, 실패한 사람은 창에 남겨 다시 저장할 수 있다.
/// </summary>
import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { Mail, X, Loader2, ClipboardList } from 'lucide-react';
import { updateUser } from '../../api/admin';
import { needsManualEmail, planBulkEmail, missingRosterText } from '../../utils/userMailList';

export default function BulkEmailModal({ isOpen, onClose, users, onSaved, showToast }) {
  // 창을 연 순간의 대상만 고정 — 저장 뒤 목록을 새로 받아도 적던 줄이 사라지지 않게.
  const [targets, setTargets] = useState([]);
  const [inputs, setInputs] = useState({});
  const [failed, setFailed] = useState({});   // {id: 사유}
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTargets((users || []).filter(needsManualEmail));
    setInputs({});
    setFailed({});
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => planBulkEmail(targets, inputs), [targets, inputs]);
  const invalid = useMemo(() => new Set(plan.invalidIds), [plan]);

  const copyRoster = async () => {
    try {
      await navigator.clipboard.writeText(missingRosterText(targets));
      showToast(`${targets.length}명의 이름·사번·회사·부서·직책을 복사했습니다. 엑셀·메모장에 붙여 찾아보세요.`, 'success');
    } catch {
      showToast('클립보드에 복사하지 못했습니다.', 'error');
    }
  };

  const saveAll = async () => {
    if (saving || plan.toSave.length === 0 || plan.invalidIds.length) return;
    setSaving(true);
    const nextFailed = {};
    let saved = 0;
    for (const { id, email } of plan.toSave) {
      try {
        await updateUser(id, { email });
        saved += 1;
      } catch (err) {
        nextFailed[id] = err?.response?.data?.detail === 'invalid_email' ? '주소 모양 오류' : '저장 실패';
      }
    }
    setSaving(false);
    setFailed(nextFailed);
    // 저장된 사람은 창에서 뺀다 — 남은 사람(빈 칸·실패)만 이어서 볼 수 있게.
    const savedIds = new Set(plan.toSave.map(r => r.id).filter(id => !nextFailed[id]));
    setTargets(prev => prev.filter(u => !savedIds.has(u.id)));
    setInputs(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !savedIds.has(Number(id)))));
    onSaved?.();
    const failCount = Object.keys(nextFailed).length;
    if (failCount) showToast(`${saved}명 저장 · ${failCount}명 실패 — 실패한 줄을 확인하세요.`, 'warning');
    else showToast(`${saved}명의 메일을 저장했습니다. PLM 정보 갱신이 덮지 않습니다.`, 'success');
  };

  const field = (id) => inputs[id] || '';

  return (
    <Transition appear show={!!isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => { if (!saving) onClose(); }}>
        <TransitionChild as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
        </TransitionChild>
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <TransitionChild as={Fragment}
            enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
            leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
            <DialogPanel className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div className="flex items-center gap-2">
                  <Mail size={18} className="text-amber-600" aria-hidden="true" />
                  <DialogTitle className="text-base font-bold text-slate-800">메일 한 번에 넣기</DialogTitle>
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">{targets.length}명</span>
                </div>
                <button type="button" onClick={onClose} disabled={saving} aria-label="닫기"
                  className="cursor-pointer rounded-lg p-1 text-slate-500 transition-colors hover:text-slate-700 disabled:cursor-wait">
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
                <p className="text-sm text-slate-600">
                  PLM 에서 메일을 못 찾은 승인 사용자입니다. 아는 사람만 적고 저장하세요 — 빈 칸은 건너뜁니다.
                </p>
                <button type="button" onClick={copyRoster} disabled={!targets.length}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  title="이름·사번·회사·부서·직책을 탭으로 이어 복사 — 주소록에서 찾을 때 쓰세요">
                  <ClipboardList size={14} aria-hidden="true" /> 이름 목록 복사
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {targets.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-slate-500">메일이 없는 승인 사용자가 없습니다.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs font-bold text-slate-600">
                      <tr>
                        <th className="px-5 py-2">이름</th>
                        <th className="px-3 py-2">사번</th>
                        <th className="px-3 py-2">소속</th>
                        <th className="px-3 py-2 w-[38%]">메일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {targets.map(user => {
                        const bad = invalid.has(user.id);
                        return (
                          <tr key={user.id} className="border-t border-slate-100">
                            <td className="px-5 py-2 font-bold text-slate-800">{user.name || '-'}</td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-600">{user.employee_id}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">
                              {[user.company, user.department, user.position].filter(Boolean).join(' · ') || '-'}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                inputMode="email"
                                value={field(user.id)}
                                onChange={e => {
                                  setInputs(prev => ({ ...prev, [user.id]: e.target.value }));
                                  // 고치기 시작하면 지난 저장 실패 표시는 걷는다.
                                  if (failed[user.id]) setFailed(prev => { const next = { ...prev }; delete next[user.id]; return next; });
                                }}
                                placeholder={user.email ? `지금: ${user.email}` : 'name@hhi.co.kr'}
                                aria-label={`${user.name || user.employee_id} 메일`}
                                spellCheck={false}
                                autoComplete="off"
                                disabled={saving}
                                className={`w-full rounded-lg border px-2 py-1.5 font-mono text-sm text-slate-800 placeholder:text-slate-400 outline-none ${
                                  bad ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-blue-500'
                                }`}
                              />
                              {bad && <p className="mt-0.5 text-[11px] text-red-600">주소 모양이 올바르지 않습니다</p>}
                              {failed[user.id] && <p className="mt-0.5 text-[11px] text-red-600">{failed[user.id]}</p>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
                <span className="text-xs text-slate-600">
                  저장할 {plan.toSave.length}명 · 빈 칸 {plan.empty}명
                  {plan.invalidIds.length ? <span className="ml-1 font-bold text-red-600">· 주소 오류 {plan.invalidIds.length}명</span> : null}
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={onClose} disabled={saving}
                    className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-wait">
                    닫기
                  </button>
                  <button type="button" onClick={saveAll}
                    disabled={saving || plan.toSave.length === 0 || plan.invalidIds.length > 0}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                    {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                    {saving ? '저장 중…' : `${plan.toSave.length}명 저장`}
                  </button>
                </div>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
