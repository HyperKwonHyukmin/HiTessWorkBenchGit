/// <summary>
/// DrawingToAnalysis — 설계 도면(PDF) → 구조 해석 모델 변환 (개발 중).
/// 현 단계는 PDF 파일 1개 업로드 UI만 제공. 변환 로직 및 결과 영역은 추후 구현.
/// </summary>
import React, { useState, useRef } from 'react';
import { ArrowLeft, Upload, Play, FileText, Info, Construction, CheckCircle2, RefreshCw } from 'lucide-react';
import PageBanner from '../../components/ui/PageBanner';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';
import { uploadDrawingPdf } from '../../api/analysis';

const formatBytes = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

export default function DrawingToAnalysis() {
  const { setCurrentMenu } = useNavigation();
  const { showToast } = useToast();
  const [pdfFile, setPdfFile] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      showToast('PDF 파일만 업로드 가능합니다.', 'error');
      return;
    }
    setPdfFile(file);
    setUploadResult(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const handleRun = async () => {
    if (!pdfFile || uploading) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const res = await uploadDrawingPdf(pdfFile);
      setUploadResult(res.data);
      showToast(`업로드 완료 — ${res.data.filename}`, 'success');
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : (err?.message || '업로드 실패');
      showToast(`업로드 실패: ${msg}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6 relative">
      <PageBanner gradient="from-brand-blue via-blue-900 to-blue-700">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCurrentMenu('File-Based Apps')}
            className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <FileText size={18} className="text-blue-300" />
              DrawingToAnalysis
            </h1>
            <p className="text-sm text-blue-200/80 mt-0.5">설계 도면(PDF)을 구조 해석 모델로 변환</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/25 border border-amber-300/50 text-amber-100 text-[11px] font-bold">
            <Construction size={12} /> 개발 중
          </span>
        </div>
      </PageBanner>

      {/* 개발 중 안내 */}
      <div className="flex items-start gap-3 mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl shrink-0">
        <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-700 leading-relaxed">
          <span className="font-bold">개발 진행 중</span>
          {' — '}현재는 PDF 업로드 인터페이스만 제공됩니다. 변환 알고리즘 및 결과 시각화는 추후 추가될 예정입니다.
        </div>
      </div>

      {/* 본문: 좌우 분할 */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* 왼쪽 사이드바 */}
        <div className="w-[360px] shrink-0 flex flex-col gap-4">
          {/* PDF 업로드 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-blue-700 to-blue-600 px-5 py-3">
              <p className="text-xs font-bold text-white uppercase tracking-widest">도면 PDF 선택</p>
            </div>
            <div className="p-5">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  isDragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
                }`}
              >
                <Upload size={28} className="mx-auto mb-2 text-slate-400" />
                {pdfFile ? (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 truncate">{pdfFile.name}</p>
                    <p className="text-xs text-slate-400 mt-1">{formatBytes(pdfFile.size)}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-slate-500">클릭하거나 PDF를 드래그하세요</p>
                    <p className="text-xs text-slate-400 mt-1">.pdf</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {pdfFile && (
                <button
                  type="button"
                  onClick={() => { setPdfFile(null); setUploadResult(null); }}
                  disabled={uploading}
                  className="mt-2 w-full text-[11px] text-slate-400 hover:text-rose-500 font-bold transition-colors disabled:opacity-50"
                >
                  파일 제거
                </button>
              )}
            </div>
          </div>

          {/* 실행 버튼 — PDF 저장 테스트 */}
          <button
            type="button"
            onClick={handleRun}
            disabled={!pdfFile || uploading}
            title={!pdfFile ? 'PDF 파일을 먼저 선택하세요' : 'userConnection 폴더에 PDF 저장 테스트'}
            className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
              !pdfFile || uploading
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer shadow-md hover:shadow-lg'
            }`}
          >
            {uploading ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
            {uploading ? '업로드 중...' : 'PDF 업로드 테스트'}
          </button>
        </div>

        {/* 오른쪽 본문 영역 */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center justify-center overflow-auto">
          {uploadResult ? (
            <div className="w-full max-w-2xl px-6 py-10">
              <div className="flex items-center gap-3 mb-5">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50">
                  <CheckCircle2 size={24} className="text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">업로드 완료</h2>
                  <p className="text-xs text-slate-500 mt-0.5">PDF가 서버 userConnection 폴더에 저장되었습니다.</p>
                </div>
              </div>
              <dl className="space-y-2.5 text-xs">
                <div className="grid grid-cols-[100px_1fr] gap-3 items-start">
                  <dt className="font-bold text-slate-500 uppercase tracking-wider">파일명</dt>
                  <dd className="font-mono text-slate-800 break-all">{uploadResult.filename}</dd>
                </div>
                <div className="grid grid-cols-[100px_1fr] gap-3 items-start">
                  <dt className="font-bold text-slate-500 uppercase tracking-wider">타임스탬프</dt>
                  <dd className="font-mono text-slate-800">{uploadResult.timestamp}</dd>
                </div>
                <div className="grid grid-cols-[100px_1fr] gap-3 items-start">
                  <dt className="font-bold text-slate-500 uppercase tracking-wider">작업 폴더</dt>
                  <dd className="font-mono text-slate-700 break-all bg-slate-50 px-2 py-1.5 rounded border border-slate-200">{uploadResult.work_dir}</dd>
                </div>
                <div className="grid grid-cols-[100px_1fr] gap-3 items-start">
                  <dt className="font-bold text-slate-500 uppercase tracking-wider">저장 경로</dt>
                  <dd className="font-mono text-slate-700 break-all bg-slate-50 px-2 py-1.5 rounded border border-slate-200">{uploadResult.saved_path}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="text-center px-6 py-12 max-w-md">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 mb-4">
                <Construction size={28} className="text-blue-500" />
              </div>
              <h2 className="text-base font-bold text-slate-700 mb-1.5">결과 영역 — 추후 업데이트 예정</h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                도면 PDF → BDF 모델 변환 파이프라인이 구현되면 이 영역에 변환 결과와 시각화가 표시됩니다.
                현재는 <span className="font-bold text-blue-600">PDF 업로드 테스트</span>만 동작합니다 — 좌측 버튼을 누르면 서버 userConnection 폴더에 PDF가 저장됩니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
