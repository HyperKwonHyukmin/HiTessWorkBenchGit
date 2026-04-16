import React, { useState, useEffect, useRef } from 'react';
import { ShieldAlert, Lock, Eye, EyeOff } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';

/**
 * 관리자 영역 접근 시 비밀번호를 확인하는 게이트 모달.
 * onConfirm(password) 호출 → 부모에서 API 검증 후 onVerified() 또는 setError() 처리.
 */
export default function AdminPasswordGateModal({ isOpen, onClose, onConfirm, isLoading, error }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef(null);

  // 모달이 열릴 때마다 입력값 초기화 + 포커스
  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setShowPassword(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!password.trim() || isLoading) return;
    onConfirm(password);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="관리자 영역 접근 확인"
      headerBg="bg-red-700"
      size="sm"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        {/* 아이콘 + 안내 문구 */}
        <div className="flex flex-col items-center text-center gap-3 pb-1">
          <div className="p-3 bg-red-50 rounded-full border border-red-100">
            <ShieldAlert size={32} className="text-red-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-700">관리자 전용 영역입니다</p>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              접근하려면 관리자 게이트 비밀번호를 입력하세요.
            </p>
          </div>
        </div>

        {/* 비밀번호 입력 */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-600 flex items-center gap-1">
            <Lock size={11} /> 게이트 비밀번호
          </label>
          <div className="relative">
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
              disabled={isLoading}
              className={`w-full px-3 py-2.5 pr-10 text-sm border rounded-lg outline-none transition-colors bg-white
                ${error
                  ? 'border-red-400 focus:border-red-500 bg-red-50'
                  : 'border-slate-200 focus:border-red-400'
                }
                disabled:bg-slate-50 disabled:text-slate-400`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-500 font-medium flex items-center gap-1">
              <Lock size={11} /> {error}
            </p>
          )}
        </div>

        {/* 버튼 영역 */}
        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 cursor-pointer"
          >
            취소
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!password.trim() || isLoading}
            className="flex-1 cursor-pointer bg-red-600 hover:bg-red-700 border-red-600"
          >
            {isLoading ? '확인 중...' : '입장'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
