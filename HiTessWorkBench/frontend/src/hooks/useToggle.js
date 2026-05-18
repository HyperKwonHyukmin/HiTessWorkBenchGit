import { useCallback, useState } from 'react';

/**
 * boolean state + 토글/오픈/닫기 액션을 묶은 작은 훅.
 *
 * 모달 open/close, 콘텐츠 펼침/접기 등 12+ 페이지에서 반복되던
 * `useState(false)` + 핸들러 3 개 패턴을 단일 훅으로 단순화.
 *
 *     const { isOpen, open, close, toggle } = useToggle();
 *     <button onClick={open}>열기</button>
 *     {isOpen && <Modal onClose={close} />}
 *
 * @param {boolean} [initialValue=false]
 * @returns {{ isOpen: boolean, open: () => void, close: () => void, toggle: () => void, setOpen: (v: boolean) => void }}
 */
export function useToggle(initialValue = false) {
  const [isOpen, setIsOpen] = useState(initialValue);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);
  return { isOpen, open, close, toggle, setOpen: setIsOpen };
}
