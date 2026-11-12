import React, { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Copy, ExternalLink, Megaphone, X } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { API_BASE_URL } from '../config';
import { copyUpdateLink, openUpdateInBrowser, sendUpdateBeacon, updatePageUrl } from '../api/updates';
import { readBeaconMessage } from '../utils/updateNotices';

/**
 * 업데이트 안내 창(2026-11-12) — 서버 공개 페이지 /updates 를 앱 안에 그대로 넣어 보여 준다(내용은 서버 updates.json).
 * 페이지는 ?embed=1 이면 본 기록을 postMessage 로 넘기고, 이 창이 로그인과 함께 서버로 보낸다(사번 기록 — 사용자 결정).
 */

// 기록 받기는 앱 전체에 한 번만, 지우지 않는다 — 창을 닫는 순간 iframe 이 보내는 마지막 기록(읽은 시간)이
// 리스너 해제와 엇갈려 사라지지 않게. 출처는 지금 서버 주소와 같은 것만 받는다.
let relayInstalled = false;
function installBeaconRelay() {
  if (relayInstalled || typeof window === 'undefined') return;
  relayInstalled = true;
  window.addEventListener('message', (event) => {
    let origin;
    try { origin = new URL(API_BASE_URL).origin; } catch { return; }
    if (event.origin !== origin) return;
    const payload = readBeaconMessage(event.data);
    if (payload) sendUpdateBeacon(payload);
  });
}

export default function UpdateNoticeModal({ isOpen, entryId, onClose }) {
  installBeaconRelay();
  const { showToast } = useToast();
  const copyLink = async () => {
    const url = await copyUpdateLink(entryId);
    if (url) showToast(`안내 주소를 복사했습니다: ${url}`, 'success');
    else showToast('복사하지 못했습니다.', 'error');
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-slate-900/50" aria-hidden="true" />
        </Transition.Child>
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-[0.98]" enterTo="opacity-100 scale-100"
            leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-[0.98]">
            <Dialog.Panel className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#002554] px-4 py-2.5 text-white">
                <Dialog.Title className="flex items-center gap-2 text-sm font-bold">
                  <Megaphone size={16} aria-hidden="true" /> 업데이트 안내
                </Dialog.Title>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={copyLink}
                    className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/90 hover:bg-white/10">
                    <Copy size={14} aria-hidden="true" /> 주소 복사
                  </button>
                  <button type="button" onClick={() => openUpdateInBrowser(entryId)}
                    className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/90 hover:bg-white/10">
                    <ExternalLink size={14} aria-hidden="true" /> 브라우저로 열기
                  </button>
                  <button type="button" onClick={onClose} aria-label="닫기"
                    className="rounded-md p-1.5 text-white/90 hover:bg-white/10">
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {isOpen && (
                <iframe title="업데이트 안내" src={updatePageUrl(entryId)} className="w-full flex-1 border-0 bg-[#f2f4f8]" />
              )}
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
