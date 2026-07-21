/**
 * @fileoverview 전역 Toast 알림 시스템.
 * useToast() 훅으로 어디서나 success / error / warning / info 알림을 띄울 수 있습니다.
 *
 * @example
 * const { showToast } = useToast();
 * showToast('저장 완료!', 'success');
 * showToast('연결 실패', 'error');
 */
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = {
  success: <CheckCircle size={18} className="shrink-0 text-emerald-500" />,
  error:   <AlertCircle  size={18} className="shrink-0 text-red-500" />,
  warning: <AlertTriangle size={18} className="shrink-0 text-amber-500" />,
  info:    <Info          size={18} className="shrink-0 text-blue-500" />,
};

const BG = {
  success: 'border-emerald-200 bg-emerald-50',
  error:   'border-red-200   bg-red-50',
  warning: 'border-amber-200 bg-amber-50',
  info:    'border-blue-200  bg-blue-50',
};

let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  /**
   * @param {string} message 표시할 메시지
   * @param {'success'|'error'|'warning'|'info'} type 종류
   * @param {number} duration 자동 닫힘(ms). 0이면 수동 닫기 전까지 유지
   * @param {{onClick?: Function, actionLabel?: string}} [options] 클릭 액션(선택)
   */
  const showToast = useCallback((message, type = 'info', duration = 4000, options = {}) => {
    const id = ++idCounter;
    setToasts(prev => [...prev, { id, message, type, onClick: options.onClick, actionLabel: options.actionLabel }]);
    if (duration > 0) {
      timersRef.current[id] = setTimeout(() => dismiss(id), duration);
    }
    return id;
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Toast 컨테이너 — 우측 상단 고정 */}
      <div className="fixed top-4 right-4 z-[99998] flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => {
          const clickable = typeof toast.onClick === 'function';
          const handleClick = () => { toast.onClick(); dismiss(toast.id); };
          return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg max-w-sm w-full pointer-events-auto animate-fade-in-up ${BG[toast.type]}`}
          >
            {ICONS[toast.type]}
            <div className="flex-1 min-w-0">
              {clickable ? (
                <button onClick={handleClick} className="w-full text-left cursor-pointer group">
                  <p className="text-sm text-slate-700 font-medium break-words">{toast.message}</p>
                  {toast.actionLabel && (
                    <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-blue-600 group-hover:underline">
                      {toast.actionLabel} →
                    </span>
                  )}
                </button>
              ) : (
                <p className="text-sm text-slate-700 font-medium break-words">{toast.message}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-slate-400 hover:text-slate-600 transition-colors shrink-0 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};
