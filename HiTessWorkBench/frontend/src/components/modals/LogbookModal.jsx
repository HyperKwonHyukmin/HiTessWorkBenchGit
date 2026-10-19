// Hi-TESS LogBook 모달 — 대시보드 [Hi-TESS LogBook] 단추가 연다.
//
// 열 때마다 /api/logbook/launch 로 30초 일회 코드 주소(/sso?code=…)를 새로 받아 iframe 에 싣는다.
// LogBook 이 그 코드로 자동 로그인해 화면을 보여 준다(토큰은 LogBook 이 자기 저장소에 둔다).
//   - 코드는 한 번만 쓰이므로 [다시 시도]·[새로 고침]도 코드를 새로 받는다.
//   - [새 창으로 열기]는 GMU·Truss 와 같은 LogBook 창(open-app-window)을 연다 — 큰 화면이 필요할 때.
//   - 이 모달 안에는 [WorkBench로 보내기] 다리가 없다(보내기는 GMU·Truss 화면의 가져오기 단추로 연 창에서).
import React, { Fragment, useEffect, useRef, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { BookOpen, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import { launchLogbook } from '../../api/logbook';
import { useLogbookLauncher } from '../analysis/runFrame/LogbookImportButton';
import { logbookErrorMessage } from '../../utils/logbookLink';

const FRAME_TIMEOUT_MS = 20000;

export default function LogbookModal({ isOpen, onClose, showToast }) {
  const [state, setState] = useState({ phase: 'idle', url: '', error: '' }); // idle | launching | loading | ready | error
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const { open: openWindow, launching: windowLaunching } = useLogbookLauncher({
    showToast: showToast || (() => {}),
    openedMessage: 'Hi-TESS LogBook 을 새 창으로 열었습니다.',
  });

  // 열릴 때(또는 다시 시도할 때) 일회 코드 주소를 새로 받는다
  useEffect(() => {
    if (!isOpen) {
      setState({ phase: 'idle', url: '', error: '' });
      return undefined;
    }
    const id = ++seq.current;
    setState({ phase: 'launching', url: '', error: '' });
    launchLogbook({})
      .then(({ data }) => {
        if (id !== seq.current) return;
        if (!data?.url) throw new Error('LogBook 주소를 받지 못했습니다.');
        setState({ phase: 'loading', url: data.url, error: '' });
      })
      .catch((e) => {
        if (id === seq.current) setState({ phase: 'error', url: '', error: logbookErrorMessage(e) });
      });
    return () => { seq.current += 1; };
  }, [isOpen, attempt]);

  // iframe 이 너무 오래 안 뜨면 서버가 꺼진 것으로 본다(iframe 은 연결 실패를 onError 로 알리지 않는다)
  useEffect(() => {
    if (state.phase !== 'loading') return undefined;
    const t = window.setTimeout(() => {
      setState((s) => (s.phase === 'loading'
        ? { ...s, phase: 'error', error: 'LogBook 화면을 여는 데 시간이 너무 오래 걸립니다. LogBook 서버를 확인해 주세요.' }
        : s));
    }, FRAME_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [state.phase, state.url]);

  const reload = () => setAttempt((n) => n + 1);
  const openInWindow = async () => {
    await openWindow();
    onClose();
  };
  const showFrame = (state.phase === 'loading' || state.phase === 'ready') && state.url;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-center justify-center p-3">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-250" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
            leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel
              className="flex w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl bg-brand-blue shadow-2xl"
              style={{ height: 'min(94vh, 1080px)' }}
            >
              {/* 머리 */}
              <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3"
                style={{ background: 'linear-gradient(90deg, #00305c 0%, #002554 70%)' }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="rounded-lg border border-white/15 bg-white/10 p-2">
                    <BookOpen size={18} className="text-blue-200" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <Dialog.Title className="text-sm font-bold leading-tight text-white">Hi-TESS LogBook</Dialog.Title>
                    <p className="truncate text-[11px] text-slate-300">구조해석 자료 창고 · WorkBench 계정으로 자동 로그인</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={reload}
                    disabled={state.phase === 'launching'}
                    title="새로 고침"
                    aria-label="LogBook 새로 고침"
                    className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 cursor-pointer"
                  >
                    <RefreshCw size={16} className={state.phase === 'launching' ? 'animate-spin' : ''} />
                  </button>
                  <button
                    type="button"
                    onClick={openInWindow}
                    disabled={windowLaunching}
                    title="새 창으로 열기"
                    aria-label="LogBook 새 창으로 열기"
                    className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 cursor-pointer"
                  >
                    {windowLaunching ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    title="닫기"
                    aria-label="LogBook 닫기"
                    className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* 본문 */}
              <div className="relative flex-1 overflow-hidden bg-white">
                {showFrame && (
                  <iframe
                    key={state.url}
                    src={state.url}
                    title="Hi-TESS LogBook"
                    allow="clipboard-read; clipboard-write; fullscreen"
                    onLoad={() => setState((s) => (s.url ? { ...s, phase: 'ready' } : s))}
                    className={`h-full w-full border-0 transition-opacity duration-200 ${state.phase === 'ready' ? 'opacity-100' : 'opacity-0'}`}
                  />
                )}
                {(state.phase === 'launching' || state.phase === 'loading') && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
                    <Loader2 size={28} className="animate-spin text-brand-blue" aria-hidden="true" />
                    <p className="text-sm font-medium">LogBook 에 로그인하는 중…</p>
                  </div>
                )}
                {state.phase === 'error' && (
                  <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                    <p className="text-sm font-bold text-slate-700">LogBook 을 열지 못했습니다.</p>
                    <p className="max-w-md text-xs text-slate-500">{state.error}</p>
                    <button
                      type="button"
                      onClick={reload}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:border-blue-400 hover:text-blue-700 cursor-pointer"
                    >
                      <RefreshCw size={13} aria-hidden="true" /> 다시 시도
                    </button>
                  </div>
                )}
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
