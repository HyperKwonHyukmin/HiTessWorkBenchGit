/// <summary>
/// Model Builder 실행 · GMU 권상 BDF 검증 전 호선 확인 창 — 적은 호선도, CSV 파일명에서 찾은 호선도 없을 때 한 번 묻는다(2026-11-06 사용자 요청).
/// 여기서 적으면 그 값으로 진행하고, '호선 없이 진행' 을 고르면 그대로 넘어간다(막지 않는다).
/// </summary>
import React, { Fragment, useEffect, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { AlertTriangle, X } from 'lucide-react';
import { HULL_NO_MAX_LENGTH, HULL_PROMPT_MESSAGE, HULL_PROMPT_TITLE, sanitizeHullInput } from '../../utils/hullNo';

export default function HullPromptDialog({ isOpen, onClose, onSubmit, onSkip, message = HULL_PROMPT_MESSAGE }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { if (isOpen) setValue(''); }, [isOpen]);
  const hull = sanitizeHullInput(value);

  const submit = () => { if (hull) onSubmit(hull); };

  return (
    <Transition appear show={!!isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[9999]" onClose={onClose} initialFocus={inputRef}>
        <TransitionChild as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
        </TransitionChild>
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <TransitionChild as={Fragment}
            enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
            leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
            <DialogPanel className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={18} className="text-amber-500" aria-hidden="true" />
                  <DialogTitle className="text-base font-bold text-slate-800">{HULL_PROMPT_TITLE}</DialogTitle>
                </div>
                <button type="button" onClick={onClose} aria-label="닫기"
                  className="cursor-pointer rounded-lg p-1 text-slate-500 transition-colors hover:text-slate-700">
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-3 px-5 py-4">
                <p className="text-sm leading-relaxed text-slate-600">{message}</p>
                <label className="flex items-center gap-3">
                  <span className="text-sm font-bold text-slate-700">호선</span>
                  <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(sanitizeHullInput(e.target.value))}
                    onKeyDown={(e) => {
                      // 한글 조합을 확정하는 Enter 는 넘긴다(CLAUDE.md 입력칸 규칙)
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === 'Enter') { e.preventDefault(); submit(); }
                    }}
                    placeholder="예: 3454"
                    maxLength={HULL_NO_MAX_LENGTH}
                    aria-label="호선 번호"
                    spellCheck={false}
                    autoComplete="off"
                    className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
                <button type="button" onClick={onSkip}
                  className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50">
                  호선 없이 진행
                </button>
                <button type="button" onClick={submit} disabled={!hull}
                  className="cursor-pointer rounded-lg bg-brand-blue px-4 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                  호선 넣고 진행
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
