// NOTE: 다운로드 링크는 <a download> 방식 사용. 다른 페이지처럼 axios+getAuthHeaders 패턴으로
// 통합하는 리팩터링은 Phase 2 useAnalysisJob 훅 도입과 함께 처리 예정.
import React, { useState, useEffect, useRef } from 'react';
import {
  UploadCloud, FileText, Download, ChevronDown, ChevronUp,
  Loader2, CheckCircle2, AlertCircle, ArrowLeft,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { API_BASE_URL } from '../../config';
import PageBanner from '../../components/ui/PageBanner';

const API_ENDPOINT = '/api/analysis/mooring-fitting/request';
const STATUS_ENDPOINT = (jobId) => `/api/analysis/status/${jobId}`;
const DOWNLOAD_ENDPOINT = (path) => `/api/download?filepath=${encodeURIComponent(path)}`;

export default function MooringFittingAssessment() {
  const [structureFile, setStructureFile] = useState(null);
  const [loadFile, setLoadFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null); // { status, progress, message, engine_log, project }
  const [showAll, setShowAll] = useState(false);
  const pollRef = useRef(null);
  const { showToast } = useToast();
  const { startGlobalJob } = useDashboard();
  const { setCurrentMenu } = useNavigation();

  // 진행 폴링 — 1.5초 간격
  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}${STATUS_ENDPOINT(jobId)}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        setJobStatus(data);
        if (data.status === 'Success' || data.status === 'Failed') {
          clearInterval(pollRef.current);
        }
      } catch (e) { /* network blip — keep polling */ }
    };
    tick();
    pollRef.current = setInterval(tick, 1500);
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  const handleRun = async () => {
    if (!structureFile || !loadFile) {
      showToast('Structure CSV와 Load CSV를 모두 선택하세요', 'error');
      return;
    }
    let user = {};
    try {
      user = JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      // localStorage 손상 시 빈 객체로 폴백 — 아래 employee_id 체크에서 잡힘
    }
    if (!user?.employee_id) {
      showToast('로그인 정보가 없습니다.', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('structure_file', structureFile);
    fd.append('load_file', loadFile);
    fd.append('employee_id', user.employee_id);
    fd.append('source', 'Workbench');
    try {
      const res = await fetch(`${API_BASE_URL}${API_ENDPOINT}`, {
        method: 'POST', body: fd, credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `요청 실패 (${res.status})`);
      }
      const data = await res.json();
      setJobId(data.job_id);
      setJobStatus({ status: 'Pending', progress: 0, message: '대기 중...' });
      startGlobalJob?.(data.job_id, 'Mooring Fitting Assessment');
    } catch (e) {
      showToast(`해석 요청 실패: ${e.message}`, 'error');
    }
  };

  const isRunning = jobStatus && (jobStatus.status === 'Pending' || jobStatus.status === 'Running');
  const isSuccess = jobStatus?.status === 'Success';
  const isFailed = jobStatus?.status === 'Failed';
  const result = jobStatus?.project?.result_info;

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6">

      <PageBanner gradient="from-brand-blue via-brand-blue-dark to-blue-700">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCurrentMenu('File-Based Apps')}
            className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Mooring Fitting Assessment</h1>
            <p className="text-sm text-blue-200/80 mt-0.5">
              Structure CSV 와 Load CSV 를 업로드하면 MooringFitting.exe 가 8단계 BDF 파이프라인을 자동 실행하고 결과 산출물을 제공합니다.
            </p>
          </div>
        </div>
      </PageBanner>

      <div className="flex-1 overflow-y-auto px-1 space-y-6 pt-2">

        {/* 업로드 카드 2-column */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UploadBox
            title="Structure CSV"
            hint="MooringFittingData.csv 형식 (MF/PLATE/BRACKET/ANGLE/FLATBAR/TBAR)"
            file={structureFile}
            onChange={setStructureFile}
            disabled={isRunning}
          />
          <UploadBox
            title="Load CSV"
            hint="MooringFittingDataLoad.csv 형식 (LOADCASE 행)"
            file={loadFile}
            onChange={setLoadFile}
            disabled={isRunning}
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">
            업로드 파일명은 무관 — 서버에서 표준 파일명으로 자동 저장됩니다.
          </p>
          <button
            onClick={handleRun}
            disabled={isRunning || !structureFile || !loadFile}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded font-medium cursor-pointer disabled:cursor-not-allowed transition-colors"
          >
            {isRunning
              ? <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={16} />해석 중…</span>
              : 'Run Analysis'}
          </button>
        </div>

        {/* 진행 패널 */}
        {isRunning && (
          <div className="bg-gray-50 border rounded p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{jobStatus.message}</span>
              <span className="text-sm text-gray-500">{jobStatus.progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${jobStatus.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* 실패 패널 */}
        {isFailed && (
          <div className="bg-red-50 border border-red-300 rounded p-4">
            <div className="flex items-center gap-2 text-red-800 font-semibold mb-2">
              <AlertCircle size={18} /> 해석 실패
            </div>
            <details className="text-xs text-gray-700">
              <summary className="cursor-pointer">실행 로그</summary>
              <pre className="whitespace-pre-wrap mt-2 p-2 bg-white border rounded max-h-60 overflow-auto">
                {jobStatus.engine_log || '(로그 없음)'}
              </pre>
            </details>
          </div>
        )}

        {/* 결과 패널 */}
        {isSuccess && result && !result._artifacts_missing && (
          <ResultPanel result={result} showAll={showAll} setShowAll={setShowAll} />
        )}

      </div>
    </div>
  );
}

// ==========================================
// Helper Components
// ==========================================

function UploadBox({ title, hint, file, onChange, disabled }) {
  const inputRef = useRef(null);
  return (
    <div className="border-2 border-dashed rounded p-5 hover:border-blue-400 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium">{title}</h3>
        {file && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle2 size={14} />{file.name}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-3">{hint}</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="w-full py-2 border rounded text-sm hover:bg-gray-50 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed transition-colors"
      >
        <UploadCloud size={16} /> CSV 파일 선택
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
    </div>
  );
}

function ResultPanel({ result, showAll, setShowAll }) {
  const coreItems = [
    { key: 'final_bdf',        label: '최종 BDF (STAGE_07_FinalValidation.bdf)' },
    { key: 'validation_json',  label: '최종 검증 결과 (validation.json)' },
    { key: 'lineage_json',     label: 'ID Timeline (LINEAGE.json)' },
    { key: 'report_mf_csv',    label: 'MF 하중 리포트 (CSV)' },
    { key: 'report_winch_csv', label: 'Winch 하중 리포트 (CSV)' },
  ];
  return (
    <div className="bg-green-50 border border-green-300 rounded p-4">
      <div className="flex items-center gap-2 text-green-800 font-semibold mb-3">
        <CheckCircle2 size={18} /> 해석 완료
      </div>
      <p className="text-xs text-gray-600 mb-3">
        작업 폴더: <code className="bg-white px-1.5 py-0.5 border rounded text-[11px]">{result.case_dir}</code>
      </p>

      <h4 className="text-sm font-semibold mb-2">핵심 산출물</h4>
      <ul className="space-y-1 mb-4">
        {coreItems.map(({ key, label }) => {
          const path = result[key];
          return (
            <li key={key} className="flex items-center justify-between text-sm bg-white border rounded px-3 py-2">
              <span className="flex items-center gap-2 truncate"><FileText size={14} />{label}</span>
              {path ? (
                <a
                  href={`${API_BASE_URL}${DOWNLOAD_ENDPOINT(path)}`}
                  target="_blank"
                  rel="noreferrer"
                  download={path.split(/[\\/]/).pop()}
                  className="text-blue-600 hover:underline flex items-center gap-1 shrink-0 ml-2"
                >
                  <Download size={14} />다운로드
                </a>
              ) : (
                <span className="text-gray-400 text-xs shrink-0 ml-2">미생성</span>
              )}
            </li>
          );
        })}
      </ul>

      <button
        onClick={() => setShowAll(!showAll)}
        className="text-sm text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
      >
        {showAll ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        전체 8단계 산출물 {showAll ? '닫기' : '펼치기'}
      </button>

      {showAll && (
        <div className="mt-3 space-y-2">
          <ArtifactList title="STAGE_NN.json (8개)" paths={result.stage_jsons} />
          <ArtifactList title="STAGE_NN.bdf (8개)" paths={result.stage_bdfs} />
          <ArtifactList title="STAGE_NN.bdf.verification.json (8개)" paths={result.stage_verifications} />
          {result.raw_json && <ArtifactList title="STAGE_00.raw.json" paths={[result.raw_json]} />}
          {result.initial_json && <ArtifactList title="STAGE_00.initial.json" paths={[result.initial_json]} />}
        </div>
      )}
    </div>
  );
}

function ArtifactList({ title, paths }) {
  if (!paths || paths.length === 0) return null;
  return (
    <div>
      <h5 className="text-xs font-semibold text-gray-600 mb-1">{title}</h5>
      <ul className="space-y-1">
        {paths.map((p) => (
          <li key={p} className="flex items-center justify-between text-xs bg-white border rounded px-2 py-1">
            <span className="truncate">{p.split(/[\\/]/).pop()}</span>
            <a
              href={`${API_BASE_URL}${DOWNLOAD_ENDPOINT(p)}`}
              target="_blank"
              rel="noreferrer"
              download={p.split(/[\\/]/).pop()}
              className="text-blue-600 hover:underline flex items-center gap-1 shrink-0 ml-2"
            >
              <Download size={12} />다운로드
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
