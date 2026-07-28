/// <summary>
/// 사용할 수 없는 앱에 대한 접근 안내 모달입니다.
/// 개발 중·출시 예정 앱(관리자 전용)과, 관리자가 App Settings 에서 내린
/// '점검 중' 상태를 모두 처리합니다. 점검 중일 때는 관리자가 입력한 안내
/// 문구를 그대로 보여줍니다.
/// </summary>
import React from 'react';
import { Lock, ShieldAlert, Wrench, Clock, Hammer } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';

const VARIANTS = {
  maintenance: {
    label: '점검 중',
    headerBg: 'bg-amber-600',
    icon: Hammer,
    iconWrap: 'bg-amber-50',
    iconColor: 'text-amber-500',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  Developing: {
    label: '개발 진행 중',
    headerBg: 'bg-blue-700',
    icon: ShieldAlert,
    iconWrap: 'bg-blue-50',
    iconColor: 'text-blue-500',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  Planned: {
    label: '출시 예정',
    headerBg: 'bg-slate-600',
    icon: ShieldAlert,
    iconWrap: 'bg-slate-100',
    iconColor: 'text-slate-400',
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
  },
};

/**
 * @param {string}  appTitle  앱 이름
 * @param {string}  devStatus 'Developing' | 'Planned'
 * @param {string}  reason    'maintenance' 이면 점검 안내로 표시(없으면 devStatus 기준)
 * @param {string}  message   관리자가 입력한 안내 문구(점검 중일 때)
 */
export default function AdminGateModal({ isOpen, onClose, appTitle, devStatus, reason, message }) {
  const isMaintenance = reason === 'maintenance';
  const variant = VARIANTS[isMaintenance ? 'maintenance' : devStatus] || VARIANTS.Planned;
  const StatusIcon = variant.icon;
  const BadgeIcon = isMaintenance ? Wrench : (devStatus === 'Developing' ? Wrench : Clock);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isMaintenance ? '일시 중단' : '접근 제한'}
      headerBg={variant.headerBg}
      size="sm"
    >
      <div className="p-6 text-center">
        {/* 아이콘 */}
        <div className="flex justify-center mb-4">
          <div className={`relative p-4 rounded-full ${variant.iconWrap}`}>
            <StatusIcon size={36} className={variant.iconColor} />
            <span className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
              <Lock size={14} className="text-slate-500" />
            </span>
          </div>
        </div>

        {/* 앱 이름 */}
        <h3 className="font-bold text-slate-800 text-base mb-2 leading-snug">{appTitle}</h3>

        {/* 상태 배지 */}
        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold mb-4 border ${variant.badge}`}>
          <BadgeIcon size={11} />
          {variant.label}
        </div>

        {/* 안내 문구 — 점검 중이면 관리자가 입력한 사유를 그대로 노출 */}
        {isMaintenance ? (
          <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
            {message || '현재 점검 중입니다. 잠시 후 다시 시도해주세요.'}
          </p>
        ) : (
          <p className="text-sm text-slate-500 leading-relaxed">
            이 앱은 현재 <span className="font-semibold text-slate-700">{variant.label}</span> 단계로,<br />
            <span className="font-semibold text-slate-700">관리자 계정</span>에서만 접근할 수 있습니다.
          </p>
        )}
        <p className="text-xs text-slate-400 mt-2">
          {isMaintenance
            ? '점검이 끝나면 다시 사용할 수 있습니다.'
            : '접근 권한이 필요하시면 시스템 관리자에게 문의하세요.'}
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
