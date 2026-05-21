import React, { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { downloadUsageReportXlsx } from '../../../api/reports';
import { useToast } from '../../../contexts/ToastContext';

export default function ExportXlsxButton({ period, date, disabled }) {
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const onClick = async () => {
    setBusy(true);
    try {
      await downloadUsageReportXlsx({ period, date });
      showToast('Excel 다운로드 완료', 'success');
    } catch {
      showToast('Excel 다운로드 실패 — 다시 시도해주세요', 'error');
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
                           : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
    >
      {busy ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
      Excel 다운로드
    </button>
  );
}
