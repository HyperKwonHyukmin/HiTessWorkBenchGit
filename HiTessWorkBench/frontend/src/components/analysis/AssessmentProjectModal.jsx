import React, { useState } from 'react';
import { CheckCircle2, RefreshCw, FileOutput, Download } from 'lucide-react';
import { exportAssessmentXlsx } from '../../api/analysis';
import { extractFilename } from '../../utils/fileHelper';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

export default function AssessmentProjectModal({ project, onClose }) {
  const [downloading, setDownloading] = useState({});

  const handleXlsxDownload = async (jsonPath, label) => {
    setDownloading(prev => ({ ...prev, [label]: true }));
    try {
      const response = await exportAssessmentXlsx(jsonPath);
      const baseName = extractFilename(jsonPath).replace(/\.json$/i, '');
      const filename  = `${baseName}_Results.xlsx`;
      const blobUrl   = window.URL.createObjectURL(new Blob([response.data]));
      const link      = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Excel export failed:', error);
      alert('Excel 파일 생성에 실패했습니다.');
    } finally {
      setDownloading(prev => ({ ...prev, [label]: false }));
    }
  };

  const jsonFiles = project?.result_info
    ? Object.entries(project.result_info).filter(([k]) => k.startsWith('JSON_'))
    : [];

  return (
    <Modal
      isOpen={!!project}
      onClose={onClose}
      title="해석 완료 및 파일 다운로드"
      size="lg"
      footer={
        <div className="flex justify-end">
          <Button variant="primary" size="md" onClick={onClose}>닫기</Button>
        </div>
      }
    >
      <div className="p-6">
        {/* Job ID 표시 */}
        <p className="text-xs text-slate-400 font-mono mb-5 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-500" />
          Job ID: {project?.id}
        </p>

        {jsonFiles.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 mb-4">
              아래 버튼을 클릭하면 JSON 결과를 기반으로 Excel 파일을 생성하여 다운로드합니다.<br/>
              <span className="text-slate-400">시트 구성: Load Case별 Summary / Element Assessment / Distribution Panel / Side Support</span>
            </p>
            {jsonFiles.map(([key, jsonPath]) => {
              const label = key.replace(/^JSON_/i, '');
              const isLoading = downloading[label];
              return (
                <button
                  key={key}
                  onClick={() => handleXlsxDownload(jsonPath, label)}
                  disabled={isLoading}
                  className={`w-full flex items-center justify-between p-4 border-2 rounded-xl transition-all duration-200 group cursor-pointer ${
                    isLoading
                      ? 'border-emerald-300 bg-emerald-50 cursor-wait'
                      : 'border-emerald-200 hover:border-emerald-500 hover:bg-emerald-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl transition-colors ${
                      isLoading
                        ? 'bg-emerald-200 text-emerald-700'
                        : 'bg-emerald-100 text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white'
                    }`}>
                      {isLoading
                        ? <RefreshCw size={20} className="animate-spin"/>
                        : <FileOutput size={20}/>
                      }
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-bold text-slate-700">{label}.xlsx</p>
                      <p className="text-[10px] text-slate-400">
                        {isLoading ? 'DRM 문제로 XLSX 파일 직접 생성 중..' : '클릭하여 Excel 다운로드'}
                      </p>
                    </div>
                  </div>
                  <Download size={18} className={`transition-colors ${
                    isLoading ? 'text-emerald-400' : 'text-slate-300 group-hover:text-emerald-600'
                  }`}/>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-center text-slate-500 py-8">결과 파일이 없습니다.</div>
        )}
      </div>
    </Modal>
  );
}
