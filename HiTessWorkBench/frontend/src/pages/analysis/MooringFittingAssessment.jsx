// NOTE: 다운로드 링크는 <a download> 방식 사용. 다른 페이지처럼 axios+getAuthHeaders 패턴으로
// 통합하는 리팩터링은 Phase 2 useAnalysisJob 훅 도입과 함께 처리 예정.
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Upload, Play, Download, FileText, ChevronDown, ChevronUp,
  RefreshCw, CheckCircle2, AlertCircle, Terminal, Database,
  FileOutput, FileSpreadsheet, Layers, Box, XCircle,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { API_BASE_URL } from '../../config';
import PageBanner from '../../components/ui/PageBanner';

const API_ENDPOINT = '/api/analysis/mooring-fitting/request';
const STATUS_ENDPOINT = (jobId) => `/api/analysis/status/${jobId}`;
const DOWNLOAD_ENDPOINT = (path) => `/api/download?filepath=${encodeURIComponent(path)}`;

// 핵심 산출물 정의
const CORE_ITEMS = [
  { key: 'final_bdf',        label: '최종 BDF',           sub: 'STAGE_07_FinalValidation.bdf', icon: FileOutput },
  { key: 'validation_json',  label: '최종 검증 결과',      sub: 'validation.json',              icon: CheckCircle2 },
  { key: 'lineage_json',     label: 'ID Timeline',         sub: 'LINEAGE.json',                 icon: Database },
  { key: 'report_mf_csv',    label: 'MF 하중 리포트',      sub: 'CSV',                          icon: FileSpreadsheet },
  { key: 'report_winch_csv', label: 'Winch 하중 리포트',   sub: 'CSV',                          icon: FileSpreadsheet },
];

export default function MooringFittingAssessment() {
  const [structureFile, setStructureFile] = useState(null);
  const [loadFile, setLoadFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null); // { status, progress, message, engine_log, project }
  const [showAll, setShowAll] = useState(false);
  const [isLogExpanded, setIsLogExpanded] = useState(false);
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
    setJobStatus({ status: 'Pending', progress: 0, message: '서버에 작업 요청 중...' });
    setShowAll(false);
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
      startGlobalJob?.(data.job_id, 'Mooring Fitting Assessment');
    } catch (e) {
      showToast(`해석 요청 실패: ${e.message}`, 'error');
      setJobStatus(null);
    }
  };

  const isRunning = jobStatus && (jobStatus.status === 'Pending' || jobStatus.status === 'Running');
  const isSuccess = jobStatus?.status === 'Success';
  const isFailed = jobStatus?.status === 'Failed';
  const result = jobStatus?.project?.result_info;
  const canRun = structureFile && loadFile && !isRunning;

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

      {/* Main Workspace */}
      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">

        {/* LEFT PANE */}
        <div className="w-full lg:w-[400px] flex flex-col gap-5 shrink-0 overflow-y-auto pr-1 custom-scrollbar">

          {/* 1. Data Input 카드 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Database size={14} /> 1. Data Input
              </h3>
            </div>
            <div className="p-5 space-y-4">
              <UploadDropzone
                title="Structure CSV"
                hint="MooringFittingData.csv 형식 (MF/PLATE/BRACKET/ANGLE/FLATBAR/TBAR)"
                file={structureFile}
                disabled={isRunning}
                onChange={setStructureFile}
              />
              <UploadDropzone
                title="Load CSV"
                hint="MooringFittingDataLoad.csv 형식 (LOADCASE 행)"
                file={loadFile}
                disabled={isRunning}
                onChange={setLoadFile}
              />
              <p className="text-[10px] text-slate-400 text-center">
                업로드 파일명은 무관 — 서버에서 표준 파일명으로 자동 저장됩니다.
              </p>
            </div>
          </div>

          {/* 2. Model Summary 카드 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-5 py-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Box size={14} /> 2. Pipeline Summary
              </h3>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="flex items-center gap-2 text-sm text-slate-600 font-medium">
                  <FileText size={16} className="text-indigo-400" /> Structure File
                </div>
                <span className={`text-xs font-bold truncate max-w-[140px] ${structureFile ? 'text-brand-blue' : 'text-slate-400'}`}>
                  {structureFile ? structureFile.name : '미업로드'}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="flex items-center gap-2 text-sm text-slate-600 font-medium">
                  <Layers size={16} className="text-cyan-400" /> Load File
                </div>
                <span className={`text-xs font-bold truncate max-w-[140px] ${loadFile ? 'text-brand-blue' : 'text-slate-400'}`}>
                  {loadFile ? loadFile.name : '미업로드'}
                </span>
              </div>
              <div className={`mt-2 flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed text-sm font-bold transition-colors ${canRun ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-50 border-slate-300 text-slate-500'}`}>
                {canRun
                  ? <><CheckCircle2 size={18} /> Ready to Run</>
                  : <><AlertCircle size={18} /> Awaiting CSV Files</>
                }
              </div>
            </div>
          </div>

          {/* Run 버튼 */}
          <div className="flex flex-col gap-2">
            <button
              onClick={handleRun}
              disabled={!canRun}
              className={`relative w-full py-4 rounded-xl text-lg font-bold flex items-center justify-center gap-3 transition-all duration-300 shadow-lg overflow-hidden ${
                !canRun
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                  : isRunning
                    ? 'bg-[#001b3d] text-white cursor-wait'
                    : 'bg-brand-blue hover:bg-brand-blue-dark text-white hover:-translate-y-1 cursor-pointer'
              }`}
            >
              {isRunning && (
                <div
                  className="absolute left-0 top-0 bottom-0 bg-blue-600 transition-all duration-500 ease-out opacity-80"
                  style={{ width: `${jobStatus?.progress ?? 0}%` }}
                />
              )}
              <div className="relative z-10 flex items-center gap-3 drop-shadow-md">
                {isRunning
                  ? <><RefreshCw className="animate-spin" size={24} /> {jobStatus?.progress ?? 0}% — {jobStatus?.message || '해석 중...'}</>
                  : <><Play size={24} fill="currentColor" /> Run Analysis</>
                }
              </div>
            </button>
          </div>
        </div>

        {/* RIGHT PANE */}
        <div className="flex-1 flex flex-col gap-6 min-h-0">

          {/* 결과 영역 — idle / running / success / failed */}
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">

            {/* 패널 헤더 */}
            <div className="bg-gradient-to-r from-indigo-900 to-blue-800 px-5 py-3 flex items-center justify-between">
              <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <FileOutput size={14} /> Analysis Results
              </h3>
              {isSuccess && (
                <span className="flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-xs font-bold px-3 py-1 rounded-full">
                  <CheckCircle2 size={12} /> 해석 완료
                </span>
              )}
              {isFailed && (
                <span className="flex items-center gap-1.5 bg-red-500/20 border border-red-400/30 text-red-200 text-xs font-bold px-3 py-1 rounded-full">
                  <XCircle size={12} /> 해석 실패
                </span>
              )}
              {isRunning && (
                <span className="flex items-center gap-1.5 bg-blue-400/20 border border-blue-300/30 text-blue-200 text-xs font-bold px-3 py-1 rounded-full animate-pulse">
                  <RefreshCw size={12} className="animate-spin" /> 진행 중
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">

              {/* Idle 상태 */}
              {!jobStatus && (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
                  <FileOutput size={48} className="opacity-20" />
                  <p className="text-sm">좌측에서 CSV 파일을 업로드하고 Run Analysis 를 실행하면 결과가 여기에 표시됩니다.</p>
                </div>
              )}

              {/* 진행 패널 */}
              {isRunning && (
                <div className="animate-fade-in-up space-y-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold text-blue-800">{jobStatus.message}</span>
                      <span className="text-sm font-mono font-bold text-blue-600">{jobStatus.progress}%</span>
                    </div>
                    <div className="w-full bg-blue-100 rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-brand-blue h-3 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${jobStatus.progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-blue-500 mt-3">MooringFitting.exe 가 8단계 BDF 파이프라인을 실행하고 있습니다...</p>
                  </div>

                  {/* 8단계 파이프라인 시각화 */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Pipeline Stages</h4>
                    <div className="grid grid-cols-4 gap-2">
                      {Array.from({ length: 8 }, (_, i) => {
                        const stageProgress = Math.floor((jobStatus.progress / 100) * 8);
                        const isDone = i < stageProgress;
                        const isActive = i === stageProgress;
                        return (
                          <div key={i} className={`flex flex-col items-center p-2 rounded-lg border text-xs font-bold transition-colors ${
                            isDone ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : isActive ? 'bg-blue-100 border-blue-300 text-blue-700 animate-pulse'
                            : 'bg-white border-slate-200 text-slate-400'
                          }`}>
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center mb-1 text-[10px] ${
                              isDone ? 'bg-emerald-500 text-white'
                              : isActive ? 'bg-blue-500 text-white'
                              : 'bg-slate-200 text-slate-500'
                            }`}>
                              {isDone ? '✓' : String(i).padStart(2, '0')}
                            </span>
                            ST{String(i).padStart(2, '0')}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* 실패 패널 */}
              {isFailed && (
                <div className="animate-fade-in-up space-y-3">
                  <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
                    <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={20} />
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-red-700 mb-1">Analysis Failed</h4>
                      <p className="text-xs text-red-600">해석 중 오류가 발생하여 결과 파일이 생성되지 않았습니다.</p>
                    </div>
                  </div>
                  <div className="bg-[#0F172A] rounded-xl border border-slate-700 overflow-hidden">
                    <button
                      onClick={() => setIsLogExpanded(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-slate-300 hover:text-white cursor-pointer"
                    >
                      <span className="flex items-center gap-2"><Terminal size={14} /> 실행 로그</span>
                      {isLogExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {isLogExpanded && (
                      <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap px-4 pb-4 max-h-72 overflow-auto bg-black/30 custom-scrollbar">
                        {jobStatus.engine_log || '(로그 없음)'}
                      </pre>
                    )}
                  </div>
                </div>
              )}

              {/* 결과 패널 */}
              {isSuccess && result && !result._artifacts_missing && (
                <ResultPanel result={result} showAll={showAll} setShowAll={setShowAll} />
              )}

            </div>
          </div>

          {/* System Console */}
          <div className="h-52 bg-[#0F172A] rounded-2xl shadow-xl border border-slate-700 flex flex-col overflow-hidden shrink-0">
            <div className="h-10 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-slate-400" />
                <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-widest">System Console</span>
              </div>
            </div>
            <div className="flex-1 p-4 font-mono text-[13px] overflow-y-auto custom-scrollbar">
              {!jobStatus && (
                <p className="text-slate-600">Waiting for task execution...</p>
              )}
              {jobStatus && (
                <div>
                  {jobStatus.status === 'Pending' && (
                    <p className="text-slate-400">[INFO] 작업 대기 중 (Pending)...</p>
                  )}
                  {jobStatus.status === 'Running' && (
                    <p className="text-sky-400">[INFO] 해석 진행 중 — {jobStatus.progress}% ({jobStatus.message})</p>
                  )}
                  {jobStatus.status === 'Success' && (
                    <p className="text-brand-accent font-bold">[SUCCESS] 해석이 성공적으로 완료되었습니다. 결과 패널을 확인하세요.</p>
                  )}
                  {jobStatus.status === 'Failed' && (
                    <p className="text-red-400">[ERROR] 해석 실패. 결과 패널에서 로그를 확인하세요.</p>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ==========================================
// Helper Components
// ==========================================

function UploadDropzone({ title, hint, file, onChange, disabled }) {
  const inputRef = useRef(null);
  const isUploaded = !!file;

  const handleDrop = (e) => {
    e.preventDefault();
    if (disabled) return;
    const dropped = Array.from(e.dataTransfer.files).find(f => f.name.endsWith('.csv'));
    if (dropped) onChange(dropped);
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`relative p-4 rounded-xl border-2 border-dashed transition-all ${
        disabled ? 'opacity-60 cursor-not-allowed'
        : isUploaded ? 'border-brand-accent/50 bg-green-50/30 cursor-pointer'
        : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 cursor-pointer'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
        disabled={disabled}
      />
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-lg ${isUploaded ? 'bg-brand-accent/20 text-brand-accent' : 'bg-slate-100 text-slate-400'}`}>
          {isUploaded ? <FileText size={24} /> : <Upload size={24} />}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold text-slate-700">{title}</h4>
          <p className="text-xs text-slate-500 truncate">
            {isUploaded ? file.name : hint}
          </p>
        </div>
      </div>
    </div>
  );
}

function ResultPanel({ result, showAll, setShowAll }) {
  return (
    <div className="animate-fade-in-up space-y-5">
      {/* 성공 헤더 */}
      <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={20} />
        <div>
          <h4 className="text-sm font-bold text-emerald-700">해석 완료</h4>
          {result.case_dir && (
            <p className="text-xs text-slate-500 mt-1">
              작업 폴더:{' '}
              <code className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[11px] font-mono text-slate-600">
                {result.case_dir}
              </code>
            </p>
          )}
        </div>
      </div>

      {/* 핵심 산출물 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <FileOutput size={14} /> 핵심 산출물
          </h3>
        </div>
        <div className="p-4 space-y-2">
          {CORE_ITEMS.map(({ key, label, sub, icon: Icon }) => {
            const path = result[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg shrink-0">
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700 truncate">{label}</p>
                    <p className="text-[10px] text-slate-400">{sub}</p>
                  </div>
                </div>
                {path ? (
                  <a
                    href={`${API_BASE_URL}${DOWNLOAD_ENDPOINT(path)}`}
                    target="_blank"
                    rel="noreferrer"
                    download={path.split(/[\\/]/).pop()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-blue text-white text-xs font-bold rounded-lg hover:bg-brand-blue-dark transition-colors shrink-0 ml-2 cursor-pointer"
                    onClick={e => e.stopPropagation()}
                  >
                    <Download size={12} /> 다운로드
                  </a>
                ) : (
                  <span className="text-slate-400 text-xs shrink-0 ml-2 px-3 py-1.5">미생성</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 전체 8단계 펼치기 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          onClick={() => setShowAll(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3 bg-gradient-to-r from-slate-700 to-slate-600 cursor-pointer"
        >
          <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <Layers size={14} /> 전체 8단계 산출물
          </h3>
          {showAll
            ? <ChevronUp size={16} className="text-white/70" />
            : <ChevronDown size={16} className="text-white/70" />
          }
        </button>

        {showAll && (
          <div className="p-4 space-y-4 animate-fade-in-up">
            <ArtifactGroup title="STAGE_NN.json (8개)" paths={result.stage_jsons} />
            <ArtifactGroup title="STAGE_NN.bdf (8개)" paths={result.stage_bdfs} />
            <ArtifactGroup title="STAGE_NN.bdf.verification.json (8개)" paths={result.stage_verifications} />
            {result.raw_json && <ArtifactGroup title="STAGE_00.raw.json" paths={[result.raw_json]} />}
            {result.initial_json && <ArtifactGroup title="STAGE_00.initial.json" paths={[result.initial_json]} />}
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactGroup({ title, paths }) {
  if (!paths || paths.length === 0) return null;
  return (
    <div>
      <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{title}</h5>
      <div className="space-y-1.5">
        {paths.map((p) => (
          <div
            key={p}
            className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-100 hover:border-slate-200 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={13} className="text-slate-400 shrink-0" />
              <span className="text-xs text-slate-600 truncate font-mono">{p.split(/[\\/]/).pop()}</span>
            </div>
            <a
              href={`${API_BASE_URL}${DOWNLOAD_ENDPOINT(p)}`}
              target="_blank"
              rel="noreferrer"
              download={p.split(/[\\/]/).pop()}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-brand-blue bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-lg transition-colors shrink-0 ml-2 cursor-pointer"
              onClick={e => e.stopPropagation()}
            >
              <Download size={11} /> 다운로드
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
