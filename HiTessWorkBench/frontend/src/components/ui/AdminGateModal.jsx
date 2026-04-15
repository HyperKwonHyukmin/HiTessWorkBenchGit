/// <summary>
/// 개발 중·출시 예정 앱에 대한 관리자 전용 접근 경고 모달입니다.
/// 비관리자가 Developing/Planned 앱을 클릭했을 때 표시됩니다.
/// </summary>
import React from 'react';
import { Lock, ShieldAlert, Wrench, Clock } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';

export default function AdminGateModal({ isOpen, onClose, appTitle, devStatus }) {
  const isDeveloping = devStatus === 'Developing';
  const statusLabel = isDeveloping ? '개발 진행 중' : '출시 예정';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="접근 제한"
      headerBg={isDeveloping ? 'bg-blue-700' : 'bg-slate-600'}
      size="sm"
    >
      <div className="p-6 text-center">
        {/* 아이콘 */}
        <div className="flex justify-center mb-4">
          <div className={`relative p-4 rounded-full ${isDeveloping ? 'bg-blue-50' : 'bg-slate-100'}`}>
            <ShieldAlert size={36} className={isDeveloping ? 'text-blue-500' : 'text-slate-400'} />
            <span className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
              <Lock size={14} className="text-slate-500" />
            </span>
          </div>
        </div>

        {/* 앱 이름 */}
        <h3 className="font-bold text-slate-800 text-base mb-2 leading-snug">{appTitle}</h3>

        {/* 상태 배지 */}
        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold mb-4 border ${
          isDeveloping
            ? 'bg-blue-50 text-blue-700 border-blue-200'
            : 'bg-slate-100 text-slate-600 border-slate-200'
        }`}>
          {isDeveloping ? <Wrench size={11} /> : <Clock size={11} />}
          {statusLabel}
        </div>

        {/* 안내 문구 */}
        <p className="text-sm text-slate-500 leading-relaxed">
          이 앱은 현재 <span className="font-semibold text-slate-700">{statusLabel}</span> 단계로,<br />
          <span className="font-semibold text-slate-700">관리자 계정</span>에서만 접근할 수 있습니다.
        </p>
        <p className="text-xs text-slate-400 mt-2">
          접근 권한이 필요하시면 시스템 관리자에게 문의하세요.
        </p>

        {/* 확인 버튼 */}
        <div className="mt-6">
          <Button variant="primary" size="md" onClick={onClose} className="w-full cursor-pointer">
            확인
          </Button>
        </div>
      </div>
    </Modal>
  );
}
