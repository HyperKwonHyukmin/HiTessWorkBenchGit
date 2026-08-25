/// <summary>
/// HeadlessUI Dialog 기반 통합 모달 래퍼 컴포넌트입니다.
/// isOpen/onClose, title, size, headerBg, footer를 props로 받아
/// 표준화된 모달 UI를 제공합니다.
/// ESC 키 및 오버레이 클릭으로 닫기를 지원합니다.
/// </summary>
import React, { Fragment } from 'react';
import { Dialog, Transition, TransitionChild } from '@headlessui/react';
import { X } from 'lucide-react';

// --- 정적 클래스 맵 (Tailwind JIT 호환) ---

/** size별 max-width 클래스 */
const SIZE_CLASSES = {
  sm:   'max-w-sm',
  md:   'max-w-md',
  lg:   'max-w-lg',
  xl:   'max-w-2xl',
  full: 'max-w-5xl',
  // 밀도 높은 작업용 모달(등록 폼처럼 좌우로 펼쳐야 읽히는 것) 전용.
  // 좁은 폭에 긴 폼을 욱여넣으면 스크롤만 길어지고 내용이 잘려 보인다.
  screen: 'max-w-[1600px]',
};

/**
 * Modal 컴포넌트
 *
 * @param {object}           props
 * @param {boolean}          props.isOpen            - 모달 열림 여부
 * @param {() => void}       props.onClose           - 모달 닫기 핸들러
 * @param {string}           props.title             - 모달 헤더 제목
 * @param {string}           [props.headerBg='bg-brand-blue'] - 헤더 배경 클래스
 * @param {'sm'|'md'|'lg'|'xl'|'full'} [props.size='md']     - 모달 최대 너비
 * @param {React.ReactNode}  props.children          - 모달 본문 콘텐츠
 * @param {boolean}          [props.fullscreen=false] - true 면 화면을 꽉 채운다 (여백·라운드 제거)
 * @param {React.ReactNode}  [props.headerActions]   - 헤더 우측, 닫기 버튼 왼쪽에 놓을 추가 컨트롤
 * @param {React.ReactNode}  [props.footer]          - 모달 하단 푸터 콘텐츠 (선택적)
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  headerBg = 'bg-brand-blue',
  size = 'md',
  fullscreen = false,
  headerActions,
  children,
  footer,
}) {
  const maxWidthClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={onClose}
      >
        {/* ── 배경 오버레이 애니메이션 ── */}
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          {/* 클릭 시 onClose 호출 (Dialog의 기본 동작) */}
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
        </TransitionChild>

        {/* ── 모달 패널 위치 정렬 ── */}
        <div className={`fixed inset-0 flex items-center justify-center ${fullscreen ? '' : 'p-4'}`}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95 translate-y-2"
            enterTo="opacity-100 scale-100 translate-y-0"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100 translate-y-0"
            leaveTo="opacity-0 scale-95 translate-y-2"
          >
            {/*
              패널을 flex 컬럼으로 두고 높이를 뷰포트에 묶는다.
              예전에는 본문에만 max-h-[75vh]를 걸고 패널엔 상한이 없어서,
              헤더(≈56px)+본문+푸터 합이 화면보다 커지면 푸터(=등록 버튼)가 잘려 나갔다.
              이제 본문만 남는 공간을 먹고 스크롤하므로 헤더·푸터는 항상 보인다.
            */}
            <Dialog.Panel
              className={[
                'relative flex w-full flex-col',
                'bg-white shadow-2xl overflow-hidden',
                fullscreen
                  ? 'max-w-none h-full rounded-none'
                  : `${maxWidthClass} max-h-[calc(100vh-2rem)] rounded-2xl`,
              ].join(' ')}
            >
              {/* ── 헤더 ── */}
              <div className={`flex shrink-0 items-center justify-between px-6 py-4 ${headerBg}`}>
                <Dialog.Title className="text-base font-bold text-white tracking-tight">
                  {title}
                </Dialog.Title>

                <div className="flex shrink-0 items-center gap-1">
                  {headerActions}

                  {/* X 닫기 버튼 */}
                  <button
                    onClick={onClose}
                    className="text-white/70 hover:text-white hover:bg-white/10 rounded-lg p-1 transition-colors outline-none cursor-pointer"
                    aria-label="모달 닫기"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* ── 본문 콘텐츠 (min-h-0 이 있어야 flex 자식이 실제로 줄어든다) ── */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {children}
              </div>

              {/* ── 푸터 (선택적) ── */}
              {footer && (
                <div className="shrink-0 border-t border-slate-100 px-6 py-4 bg-slate-50">
                  {footer}
                </div>
              )}
            </Dialog.Panel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
