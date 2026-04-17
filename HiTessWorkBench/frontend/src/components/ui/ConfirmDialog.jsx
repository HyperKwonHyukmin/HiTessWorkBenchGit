import React, { Fragment } from 'react';
import { Dialog, Transition, TransitionChild } from '@headlessui/react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

/**
 * ConfirmDialog — window.confirm() 대체 모달.
 * isOpen 상태를 호출자가 관리하고, onConfirm / onCancel 콜백을 받는다.
 *
 * @param {boolean}        props.isOpen
 * @param {() => void}     props.onCancel       - 취소 또는 배경 클릭 시
 * @param {() => void}     props.onConfirm      - 확인 버튼 클릭 시
 * @param {string}         [props.title='확인']
 * @param {string}         [props.message]
 * @param {string}         [props.confirmLabel='삭제']
 * @param {string}         [props.cancelLabel='취소']
 * @param {'danger'|'warning'} [props.variant='danger']
 */
export default function ConfirmDialog({
  isOpen,
  onCancel,
  onConfirm,
  title = '확인',
  message,
  confirmLabel = '삭제',
  cancelLabel = '취소',
  variant = 'danger',
}) {
  const isDanger = variant === 'danger';

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[9999]" onClose={onCancel}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
        </TransitionChild>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200" enterFrom="opacity-0 scale-95 translate-y-2"
            enterTo="opacity-100 scale-100 translate-y-0"
            leave="ease-in duration-150" leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95 translate-y-2"
          >
            <Dialog.Panel className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <AlertTriangle
                    size={18}
                    className={isDanger ? 'text-red-500' : 'text-amber-500'}
                  />
                  <Dialog.Title className="text-base font-bold text-slate-800">
                    {title}
                  </Dialog.Title>
                </div>
                <button
                  onClick={onCancel}
                  className="text-slate-400 hover:text-slate-600 rounded-lg p-1 transition-colors cursor-pointer"
                  aria-label="닫기"
                >
                  <X size={16} />
                </button>
              </div>

              {message && (
                <div className="px-5 py-4">
                  <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
                </div>
              )}

              <div className="flex justify-end gap-2 px-5 py-4 bg-slate-50 border-t border-slate-100">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-sm font-bold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-bold text-white rounded-lg transition-colors cursor-pointer shadow-sm ${
                    isDanger
                      ? 'bg-red-500 hover:bg-red-600'
                      : 'bg-amber-500 hover:bg-amber-600'
                  }`}
                >
                  {isDanger && <Trash2 size={14} />}
                  {confirmLabel}
                </button>
              </div>
            </Dialog.Panel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
