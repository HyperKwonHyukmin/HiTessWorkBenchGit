import React, { useState } from 'react';
import { Image as ImageIcon, RefreshCw } from 'lucide-react';
import { toPng } from 'html-to-image';
import { useToast } from '../../../contexts/ToastContext';

function buildFilename(period, label, date) {
  const safeLabel = (label || date || '').replace(/[^\w\-]+/g, '_');
  const cap = period ? period.charAt(0).toUpperCase() + period.slice(1) : 'Report';
  return `WorkBench_UsageReport_${cap}_${safeLabel}.png`;
}

export default function ExportPngButton({ targetRef, period, date, label, disabled }) {
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const onClick = async () => {
    const node = targetRef?.current;
    if (!node) {
      showToast('캡처할 영역을 찾을 수 없습니다', 'error');
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = buildFilename(period, label, date);
      a.click();
      showToast('PNG 다운로드 완료', 'success');
    } catch (e) {
      console.error('PNG export failed', e);
      showToast('PNG 생성 실패 — 다시 시도해주세요', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md transition shadow-sm
        ${disabled || busy ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                           : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
    >
      {busy ? <RefreshCw size={16} className="animate-spin" /> : <ImageIcon size={16} />}
      PNG 저장
    </button>
  );
}
