import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileOutput,
  FileX,
  Loader2,
  XCircle,
} from 'lucide-react';
import Badge from './Badge';

const STATUS_META = {
  Success: { variant: 'success', label: '해석 완료', icon: CheckCircle2 },
  Failed: { variant: 'error', label: '해석 실패', icon: XCircle },
  Pending: { variant: 'neutral', label: '대기 중', icon: AlertCircle },
  Running: { variant: 'info', label: '실행 중', icon: Loader2, spin: true },
  Solving: { variant: 'info', label: '해석 중', icon: Clock },
  Interrupted: { variant: 'warning', label: '중단됨', icon: AlertCircle },
  Active: { variant: 'success', label: '서비스 중', icon: CheckCircle2 },
  Developing: { variant: 'warning', label: '개발중', icon: Clock },
  Planned: { variant: 'info', label: '출시 예정', icon: Clock },
  available: { variant: 'info', label: '파일 보관 중', icon: FileOutput },
  expired: { variant: 'neutral', label: '파일 만료', icon: FileX },
};

export function getStatusMeta(status, fallbackLabel = status || '대기 중') {
  return STATUS_META[status] ?? { variant: 'neutral', label: fallbackLabel, icon: AlertCircle };
}

export default function StatusBadge({
  status,
  label,
  size = 'md',
  dot = false,
  className = '',
}) {
  const meta = getStatusMeta(status, label);
  const Icon = meta.icon;

  return (
    <Badge variant={meta.variant} size={size} dot={dot} className={className}>
      {Icon && (
        <Icon
          size={size === 'sm' ? 11 : 13}
          className={`shrink-0 ${meta.spin ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
      )}
      {label ?? meta.label}
    </Badge>
  );
}
