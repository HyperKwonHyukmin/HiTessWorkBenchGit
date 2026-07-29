import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getAnalysisHistory, downloadFileBlob, exportAssessmentXlsx, rerunAnalysisProject } from '../../api/analysis';
import { extractFilename } from '../../utils/fileHelper';
import {
  Search, Filter, Download, RefreshCw,
  ChevronRight, ChevronLeft, Box,
  CheckCircle2,
  FileCode, Database, FileOutput, Eye, FileX,
  TrendingUp, CalendarClock, Award, BarChart3, Minus,
  GitCompare, Play, Square, CheckSquare, Fingerprint
} from 'lucide-react';

import BdfViewerModal from '../../components/modals/BdfViewerModal';
import AssessmentResultViewerModal from '../../components/modals/AssessmentResultViewerModal';
import HpScrViewerModal from '../../components/modals/HpScrViewerModal';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import FeedbackState from '../../components/ui/FeedbackState';
import AssessmentProjectModal from '../../components/analysis/AssessmentProjectModal';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { findAppByProgramName, getDisplayProgramName, useGlobalJobs } from '../../contexts/DashboardContext';

const FILE_RETENTION_DAYS = 30;

const fileStatusOf = (project) => (project?.files_available === false ? 'expired' : 'available');
const supportsProjectRerun = (project) => (
  findAppByProgramName(project?.program_name)?.supportsRerun === true
);

const FileRetentionBadge = ({ project }) => {
  const expired = fileStatusOf(project) === 'expired';
  return <StatusBadge status={expired ? 'expired' : 'available'} size="md" className="whitespace-nowrap" />;
};

// ==========================================
// 2. 파일 다운로드 행 컴포넌트
// ==========================================
const FileDownloadRow = ({ label, path, icon: Icon, onClick, isResult }) => (
  <button onClick={onClick} className={`w-full flex items-center justify-between p-3 border rounded-xl transition-all group cursor-pointer ${isResult ? 'border-green-200 hover:bg-green-50' : 'border-slate-200 hover:bg-blue-50'}`}>
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-lg ${isResult ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-500'}`}><Icon size={18} /></div>
      <div className="text-left">
        <p className="text-sm font-bold text-slate-700 uppercase">{label}</p>
        <p className="text-[10px] text-slate-400 truncate max-w-[300px]">{extractFilename(path)}</p>
      </div>
    </div>
    <Download size={18} className="text-slate-300 group-hover:text-blue-600" />
  </button>
);

// ==========================================
// 3. 프로젝트 상세 모달 (공유 Modal 컴포넌트 사용)
// ==========================================
const ProjectDetailModal = ({ project, onClose, onOpen3D }) => {
  const { showToast } = useToast();
  const [xlsxDownloading, setXlsxDownloading] = useState({});
  const [filesMissing, setFilesMissing] = useState(false);

  useEffect(() => {
    setFilesMissing(project?.files_available === false);
  }, [project?.id, project?.files_available]);

  const handleDownload = async (filePath) => {
    if (!filePath || filesMissing) return;
    try {
      const response = await downloadFileBlob(filePath);
      const filename = extractFilename(filePath);
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      if (error?.response?.status === 404) {
        setFilesMissing(true);
        return;
      }
      showToast('파일 다운로드에 실패했습니다.', 'error');
    }
  };

  const handleXlsxDownload = async (jsonPath, label) => {
    if (filesMissing) return;
    setXlsxDownloading(prev => ({ ...prev, [label]: true }));
    try {
      const response = await exportAssessmentXlsx(jsonPath);
      const baseName = extractFilename(jsonPath).replace(/\.json$/i, '');
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `${baseName}_Results.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      if (error?.response?.status === 404) {
        setFilesMissing(true);
        return;
      }
      showToast('Excel 파일 생성에 실패했습니다.', 'error');
    } finally {
      setXlsxDownloading(prev => ({ ...prev, [label]: false }));
    }
  };

  const isAssessment   = project?.program_name === 'Truss Assessment';
  const isModelBuilder = project?.program_name === 'HiTessModelBuilder';
  // HP-SCR PSA / POR — XLSX 만 노출 (BDF/JSON 다운로드 숨김), 3D 시각화는 배관 전용 뷰어로
  const isHpScr        = typeof project?.program_name === 'string' && project.program_name.startsWith('HP-SCR');
  // Simplified Hole Fatigue Assessment — input_json / output_json 만 다운로드 노출
  const isHoleFatigue  = project?.program_name === 'Simplified Hole Fatigue Assessment';

  // result_info 필터링
  const getResultLabel = (key) => {
    if (key === 'bdf' || key === 'bdf_path') return 'BDF Model';
    if (key === 'XLSX_Report') return 'XLSX Report';
    if (key === 'input_json') return '입력 JSON';
    if (key === 'output_json') return '결과 JSON';
    return `${key.replace(/_/g, ' ')} Result`;
  };
  const filteredResultEntries = project?.result_info
    ? Object.entries(project.result_info).filter(([key]) => {
        if (key === 'CSV_Error' || key.startsWith('JSON_')) return false;
        if (isAssessment && key.startsWith('Excel_')) return false;
        if (isModelBuilder) return key === 'bdf_path';
        if (isHpScr) return key === 'XLSX_Report';
        if (isHoleFatigue) return key === 'input_json' || key === 'output_json';
        return true;
      })
    : [];
  // JSON_* 키는 filteredResultEntries 에서 이미 제외되므로,
  // Excel 변환 대상은 원본 result_info 에서 직접 추출한다 (Truss Assessment 전용).
  const jsonFiles = isAssessment && project?.result_info
    ? Object.entries(project.result_info).filter(
        ([key, path]) => key.startsWith('JSON_') && typeof path === 'string'
      )
    : [];

  return (
    <Modal
      isOpen={!!project}
      onClose={onClose}
      title={project?.project_name || 'Unnamed Project'}
      size="xl"
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" size="md" onClick={onClose}>닫기</Button>
        </div>
      }
    >
      {project && (
        <div className="p-6">
          {/* 메타 정보 */}
          <div className="flex items-center gap-2 mb-4 text-xs text-slate-400 font-mono">
            <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-bold">ID: {project.id}</span>
            <span>{new Date(project.created_at).toLocaleString()}</span>
            <FileRetentionBadge project={project} />
          </div>

          <section className="mb-6 rounded-xl border border-slate-200 bg-slate-50/70">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
              <Fingerprint size={15} className="text-brand-blue" />
              <h3 className="text-xs font-bold text-slate-700">Analysis Passport</h3>
              <span className="ml-auto text-[10px] font-semibold text-slate-500">추적 가능한 실행 근거</span>
            </div>
            <dl className="grid grid-cols-1 gap-px bg-slate-200 sm:grid-cols-2">
              {[
                ['Job ID', project.job_id || 'Legacy record'],
                ['Source', project.source || 'Workbench'],
                ['Requester', project.employee_id || '—'],
                ['Created', project.created_at ? new Date(project.created_at).toLocaleString() : '—'],
                ['Input contract', `${Object.keys(project.input_info || {}).length} fields`],
                ['Result contract', `${Object.keys(project.result_info || {}).length} fields`],
              ].map(([term, detail]) => (
                <div key={term} className="min-w-0 bg-white px-4 py-2.5">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{term}</dt>
                  <dd className="mt-0.5 truncate font-mono text-xs font-semibold text-slate-700" title={String(detail)}>
                    {detail}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* 3D 시각화 버튼 */}
          {project.status === 'Success' && project.result_info?.bdf && !filesMissing && (
            <button
              onClick={onOpen3D}
              className="w-full mb-6 py-4 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-center gap-3 text-indigo-700 font-bold hover:bg-indigo-100 transition-all duration-200 shadow-sm cursor-pointer group"
            >
              <Eye size={20} className="group-hover:scale-110 transition-transform" />
              과거 해석 모델 3D 시각화 실행
            </button>
          )}

          {/* Truss Assessment 결과 보고서 저장 (DRM 우회 — 백엔드가 메모리에서 XLSX 생성) */}
          {isAssessment && project.status === 'Success' && jsonFiles.length > 0 && !filesMissing && (
            <div className="mb-6">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">결과 보고서 저장</h3>
              <p className="text-xs text-slate-500 mb-3">
                아래 버튼을 클릭하면 JSON 결과를 기반으로 Excel 파일을 생성하여 다운로드합니다.<br/>
                <span className="text-slate-400">시트 구성: Load Case별 Summary / Element Assessment / Distribution Panel / Side Support</span>
              </p>
              <div className="space-y-2">
                {jsonFiles.map(([key, jsonPath]) => {
                  const label = key.replace(/^JSON_/i, '');
                  const isLoading = xlsxDownloading[label];
                  return (
                    <button
                      key={key}
                      onClick={() => handleXlsxDownload(jsonPath, label)}
                      disabled={isLoading}
                      className={`w-full flex items-center justify-between p-4 border-2 rounded-xl transition-all duration-200 group cursor-pointer ${
                        isLoading ? 'border-emerald-300 bg-emerald-50 cursor-wait' : 'border-emerald-200 hover:border-emerald-500 hover:bg-emerald-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl transition-colors ${isLoading ? 'bg-emerald-200 text-emerald-700' : 'bg-emerald-100 text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white'}`}>
                          {isLoading ? <RefreshCw size={20} className="animate-spin"/> : <FileOutput size={20}/>}
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-bold text-slate-700">{label}.xlsx</p>
                          <p className="text-[10px] text-slate-400">{isLoading ? 'DRM 문제로 XLSX 파일 직접 생성 중..' : '클릭하여 Excel 다운로드'}</p>
                        </div>
                      </div>
                      <Download size={18} className={`transition-colors ${isLoading ? 'text-emerald-400' : 'text-slate-300 group-hover:text-emerald-600'}`}/>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Analysis Status</h3>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <span className="text-xs text-slate-400 block mb-1">Execution Status</span>
              <StatusBadge status={project.status} />
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 min-w-0">
              <span className="text-xs text-slate-400 block mb-1">App</span>
              <div className="font-bold text-slate-700 flex items-center gap-2 min-w-0">
                <Box size={16} className="text-blue-500 shrink-0"/>
                <span className="truncate" title={project.program_name}>{getDisplayProgramName(project.program_name)}</span>
              </div>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <span className="text-xs text-slate-400 block mb-1">Requester</span>
              <div className="font-bold text-slate-700">{project.employee_id}</div>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <span className="text-xs text-slate-400 block mb-1">Execution Date</span>
              <div className="text-slate-700 font-bold text-sm">{new Date(project.created_at).toLocaleDateString()}</div>
            </div>
          </div>

          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Files</h3>
          {filesMissing ? (
            <div className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-500">
              <FileX size={18} className="text-slate-400 shrink-0" />
              <div>
                <p className="text-sm font-bold text-slate-600">파일 만료</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  결과 파일 보관 기간({FILE_RETENTION_DAYS}일)이 지나 서버에서 삭제되었습니다. 해석 이력은 계속 유지됩니다.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {/* input_info: Truss Assessment / Mast Post Assessment / HP-SCR / Hole Fatigue 는 숨김 */}
              {project.input_info && !isAssessment && !isHpScr && !isHoleFatigue && project.program_name !== "Mast Post Assessment" &&
                Object.entries(project.input_info).map(([key, path]) => {
                  if (typeof path !== 'string') return null;
                  const label = isModelBuilder
                    ? key.replace(/_(csv|path)$/i, '').toUpperCase()
                    : key.replace(/_/g, ' ');
                  return <FileDownloadRow key={key} label={label} path={path} icon={Database} onClick={() => handleDownload(path)} />;
                })
              }
              {/* result_info: CSV_Error 제외, bdf → BDF Model */}
              {filteredResultEntries.map(([key, path]) => (
                typeof path === 'string'
                  ? <FileDownloadRow key={key} label={getResultLabel(key)} path={path} icon={FileOutput} onClick={() => handleDownload(path)} isResult />
                  : null
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

const flattenComparisonData = (project) => {
  const flattened = {
    'Passport.Project ID': project?.id,
    'Passport.Program': getDisplayProgramName(project?.program_name),
    'Passport.Status': project?.status,
    'Passport.Job ID': project?.job_id || 'Legacy record',
    'Passport.Source': project?.source || 'Workbench',
    'Passport.Requester': project?.employee_id,
    'Passport.Created': project?.created_at ? new Date(project.created_at).toLocaleString() : '—',
    'Passport.Files': project?.files_available === false ? 'Expired' : 'Available',
  };

  const visit = (value, prefix, depth = 0) => {
    if (depth > 3) {
      flattened[prefix] = JSON.stringify(value);
      return;
    }
    if (value == null || typeof value !== 'object') {
      flattened[prefix] = typeof value === 'string' && /[\\/]/.test(value)
        ? extractFilename(value)
        : value;
      return;
    }
    if (Array.isArray(value)) {
      flattened[prefix] = value.length > 5
        ? `${JSON.stringify(value.slice(0, 5))} … (${value.length})`
        : JSON.stringify(value);
      return;
    }
    Object.entries(value).forEach(([key, nested]) => visit(nested, `${prefix}.${key}`, depth + 1));
  };

  visit(project?.input_info || {}, 'Input');
  Object.entries(project?.result_info || {}).forEach(([key, value]) => {
    flattened[`Result.${key}`] = typeof value === 'string' && /[\\/]/.test(value)
      ? extractFilename(value)
      : typeof value === 'object'
        ? JSON.stringify(value)
        : value;
  });
  return flattened;
};

/**
 * 실행 비교 모달.
 *
 * ⚠ 이 컴포넌트는 **항상 마운트되어 있고** 부모가 `projects` 로 여닫는다
 * (닫혀 있을 때는 빈 배열이 들어온다). 그래서 `isOpen` 만 보고 본문을 짜면 안 된다 —
 * JSX 는 `Modal` 이 열림 여부를 판단하기 **전에** 이미 평가되므로,
 * projects 가 비어 있으면 `projects[0].project_name` 에서 페이지 전체가 터진다.
 * (실제로 My Projects 진입 시 흰 화면 대신 Electron 배경색만 남는 사고가 있었다.)
 */
const ProjectCompareModal = ({ projects, onClose }) => {
  // null/undefined 가 섞여 들어와도 안전하게 두 개만 고른다.
  const pair = Array.isArray(projects) ? projects.filter(Boolean) : [];
  const left = pair[0];
  const right = pair[1];
  const leftData = useMemo(() => flattenComparisonData(left), [left]);
  const rightData = useMemo(() => flattenComparisonData(right), [right]);
  const keys = useMemo(
    () => [...new Set([...Object.keys(leftData), ...Object.keys(rightData)])],
    [leftData, rightData],
  );

  // 훅은 순서가 고정돼야 하므로 early return 은 반드시 훅 **뒤에** 둔다.
  if (pair.length !== 2) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Run Compare"
      size="xl"
      footer={<Button variant="secondary" onClick={onClose}>닫기</Button>}
    >
      <div className="p-6">
        <div className="mb-4 grid grid-cols-[minmax(150px,0.7fr)_minmax(220px,1fr)_minmax(220px,1fr)] gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-xs">
          <div className="bg-slate-50 px-4 py-3 font-bold text-slate-500">Field</div>
          {[left, right].map(project => (
            <div key={project.id} className="min-w-0 bg-slate-50 px-4 py-3">
              <p className="truncate font-bold text-slate-800" title={project.project_name}>{project.project_name}</p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-500">ID {project.id}</p>
            </div>
          ))}
          {keys.map(key => {
            const leftValue = leftData[key] ?? '—';
            const rightValue = rightData[key] ?? '—';
            const differs = String(leftValue) !== String(rightValue);
            return (
              <React.Fragment key={key}>
                <div className="bg-white px-4 py-2.5 font-semibold text-slate-600">{key}</div>
                <div className={`min-w-0 break-all px-4 py-2.5 font-mono ${differs ? 'bg-amber-50 text-amber-900' : 'bg-white text-slate-600'}`}>
                  {String(leftValue)}
                </div>
                <div className={`min-w-0 break-all px-4 py-2.5 font-mono ${differs ? 'bg-amber-50 text-amber-900' : 'bg-white text-slate-600'}`}>
                  {String(rightValue)}
                </div>
              </React.Fragment>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          노란 행은 값이 다른 항목입니다. 파일 경로는 보안을 위해 파일명만 비교합니다.
        </p>
      </div>
    </Modal>
  );
};

// ==========================================
// 4. 메인 MyProjects 페이지 컴포넌트
// ==========================================
const PROGRAM_FILTERS = ['All', 'TrussModelBuilder', 'Truss Assessment', 'Simple Beam Assessment'];
const STATUS_FILTERS = ['All', 'Success', 'Failed'];
const FILE_STATUS_FILTERS = [
  { value: 'All', label: 'All Files' },
  { value: 'available', label: 'Files Available' },
  { value: 'expired', label: 'Files Expired' },
];
const PAGE_SIZE = 10;

export default function MyProjects() {
  const { showToast } = useToast();
  const { employeeId } = useAuth();
  const { startGlobalJob } = useGlobalJobs();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [programFilter, setProgramFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [fileStatusFilter, setFileStatusFilter] = useState('All');
  const [selectedProject, setSelectedProject] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState(null);
  const [compareProjects, setCompareProjects] = useState([]);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [rerunningIds, setRerunningIds] = useState(() => new Set());

  // 3D 뷰어 모달 상태
  const [is3DViewerOpen, setIs3DViewerOpen] = useState(false);
  // Truss Assessment 결과 모델 뷰어(결과 색상 시각화) 상태
  const [isResultViewerOpen, setIsResultViewerOpen] = useState(false);

  // 대시보드 "프로젝트 이력" 행에서 넘어온 경우, 해당 프로젝트 상세 모달을 자동으로 연다.
  // (Dashboard.jsx 의 OPEN_PROJECT_DETAIL_KEY 와 동일 키)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('workbench:open-project-detail');
      if (raw) {
        sessionStorage.removeItem('workbench:open-project-detail');
        const project = JSON.parse(raw);
        if (project && typeof project === 'object') setSelectedProject(project);
      }
    } catch {
      // 잘못된 값이면 자동 오픈하지 않는다
    }
  }, []);

  const fetchHistory = useCallback(async (signal) => {
    try {
      setLoading(true);
      if (!employeeId) return;

      const response = await getAnalysisHistory(
        employeeId,
        (currentPage - 1) * PAGE_SIZE,
        PAGE_SIZE,
        {
          search: searchTerm || undefined,
          program_name: programFilter === 'All' ? undefined : programFilter,
          status: statusFilter === 'All' ? undefined : statusFilter,
          file_status: fileStatusFilter === 'All' ? undefined : fileStatusFilter,
          include_summary: true,
        },
      );
      if (signal?.aborted) return;
      setProjects(response.data?.items ?? response.data ?? []);
      setTotalCount(response.data?.total ?? 0);
      setSummary(response.data?.summary ?? null);
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'CanceledError') return;
      console.error("이력 불러오기 실패:", error);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [currentPage, fileStatusFilter, programFilter, searchTerm, statusFilter, employeeId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => fetchHistory(controller.signal), searchTerm ? 250 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fetchHistory, searchTerm]);

  // 필터 변경 시 첫 페이지로 리셋
  useEffect(() => { setCurrentPage(1); }, [searchTerm, programFilter, statusFilter, fileStatusFilter]);

  const toggleCompareProject = useCallback((project) => {
    setCompareProjects(current => {
      if (current.some(item => item.id === project.id)) {
        return current.filter(item => item.id !== project.id);
      }
      if (current.length >= 2) {
        showToast('실행 비교는 두 프로젝트까지 선택할 수 있습니다.', 'warning');
        return current;
      }
      return [...current, project];
    });
  }, [showToast]);

  const handleRerun = useCallback(async (project) => {
    if (!project?.id || rerunningIds.has(project.id)) return;
    setRerunningIds(current => new Set(current).add(project.id));
    try {
      const response = await rerunAnalysisProject(project.id);
      const jobId = response.data?.job_id;
      if (!jobId) throw new Error('job_id missing');
      const app = findAppByProgramName(project.program_name);
      startGlobalJob(jobId, app?.title || getDisplayProgramName(project.program_name));
      showToast('동일 입력으로 새 해석 작업을 제출했습니다.', 'success');
      window.dispatchEvent(new CustomEvent('workbench:open-job-center'));
    } catch (error) {
      const detail = error?.response?.data?.detail;
      showToast(detail || '프로젝트 재실행 요청에 실패했습니다.', 'error', 7000);
    } finally {
      setRerunningIds(current => {
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
    }
  }, [rerunningIds, showToast, startGlobalJob]);

  // ── 통계 집계 ──
  const stats = useMemo(() => {
    if (summary) return summary;
    const total = projects.length;
    const success = projects.filter(p => p.status === 'Success').length;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
    const expiredFiles = projects.filter(p => fileStatusOf(p) === 'expired').length;
    const availableFiles = total - expiredFiles;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const prevSevenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;
    const thisWeek = projects.filter(p => new Date(p.created_at).getTime() >= sevenDaysAgo).length;
    const prevWeek = projects.filter(p => {
      const t = new Date(p.created_at).getTime();
      return t >= prevSevenDaysAgo && t < sevenDaysAgo;
    }).length;
    const weekDelta = thisWeek - prevWeek;

    // 모듈별 카운트
    const moduleCount = new Map();
    for (const p of projects) {
      const key = p.program_name || 'Unknown';
      moduleCount.set(key, (moduleCount.get(key) ?? 0) + 1);
    }
    const moduleEntries = [...moduleCount.entries()].sort((a, b) => b[1] - a[1]);
    const topModule = moduleEntries[0]?.[0] ?? null;
    const topModuleCount = moduleEntries[0]?.[1] ?? 0;

    return {
      total,
      success,
      successRate,
      thisWeek,
      weekDelta,
      topModule,
      topModuleCount,
      moduleEntries,
      expiredFiles,
      availableFiles,
    };
  }, [projects, summary]);

  const MODULE_BAR_COLORS = [
    'from-blue-400 to-blue-600',
    'from-emerald-400 to-emerald-600',
    'from-violet-400 to-violet-600',
    'from-amber-400 to-amber-600',
    'from-rose-400 to-rose-600',
    'from-cyan-400 to-cyan-600',
  ];

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const paginatedProjects = projects;

  return (
    <div className="max-w-7xl mx-auto pb-10">
      
      <PageHeader
        title="My Projects"
        icon={Database}
        subtitle="구조 해석 수행 이력 및 결과 파일을 관리합니다."
        accentColor="blue"
      />

      <div className="mb-4 p-4 rounded-xl border border-blue-200 bg-blue-50 flex items-start gap-3 animate-fade-in-up">
        <div className="p-2 bg-white text-blue-600 rounded-lg border border-blue-100 shrink-0">
          <FileOutput size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-blue-900">결과 파일 보관 정책</p>
          <p className="text-xs text-blue-700/80 mt-0.5 leading-relaxed">
            해석 이력은 계속 유지되며, 서버의 결과 파일은 생성 후 {FILE_RETENTION_DAYS}일 동안 보관됩니다. 파일이 만료된 항목은 이력 확인만 가능하고 다운로드는 제한됩니다.
          </p>
        </div>
      </div>

      {/* ── 통계 요약 (KPI + 모듈 분포) ── */}
      {!loading && stats.total > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 animate-fade-in-up">
          {/* KPI 카드 4개 — lg에서는 2x2 그리드, 좌측 2/3 영역 */}
          <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* 총 해석 */}
            <div className="relative bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-hidden">
              <div className="absolute -right-3 -top-3 w-16 h-16 bg-blue-50 rounded-full opacity-60" />
              <div className="relative flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">총 해석</span>
                <div className="p-1.5 bg-blue-100 text-blue-600 rounded-lg">
                  <Database size={14} />
                </div>
              </div>
              <div className="relative">
                <span className="text-2xl font-extrabold text-slate-800 tabular-nums">{stats.total}</span>
                <span className="text-xs font-bold text-slate-400 ml-1">건</span>
              </div>
            </div>

            {/* 성공률 */}
            <div className="relative bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-hidden">
              <div className="absolute -right-3 -top-3 w-16 h-16 bg-emerald-50 rounded-full opacity-60" />
              <div className="relative flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">성공률</span>
                <div className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg">
                  <CheckCircle2 size={14} />
                </div>
              </div>
              <div className="relative flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-slate-800 tabular-nums">{stats.successRate}</span>
                <span className="text-sm font-bold text-slate-400">%</span>
              </div>
              <div className="relative mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all"
                  style={{ width: `${stats.successRate}%` }}
                />
              </div>
            </div>

            {/* 이번 주 */}
            <div className="relative bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-hidden">
              <div className="absolute -right-3 -top-3 w-16 h-16 bg-violet-50 rounded-full opacity-60" />
              <div className="relative flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">이번 주</span>
                <div className="p-1.5 bg-violet-100 text-violet-600 rounded-lg">
                  <CalendarClock size={14} />
                </div>
              </div>
              <div className="relative flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-slate-800 tabular-nums">{stats.thisWeek}</span>
                <span className="text-xs font-bold text-slate-400">건</span>
              </div>
              <div className="relative mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold">
                {stats.weekDelta > 0 ? (
                  <span className="text-emerald-600 inline-flex items-center gap-0.5">
                    <TrendingUp size={10} /> +{stats.weekDelta} vs 지난주
                  </span>
                ) : stats.weekDelta < 0 ? (
                  <span className="text-rose-500 inline-flex items-center gap-0.5">
                    <TrendingUp size={10} className="rotate-180" /> {stats.weekDelta} vs 지난주
                  </span>
                ) : (
                  <span className="text-slate-400 inline-flex items-center gap-0.5">
                    <Minus size={10} /> 변동 없음
                  </span>
                )}
              </div>
            </div>

            {/* 즐겨쓴 모듈 */}
            <div className="relative bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-hidden">
              <div className="absolute -right-3 -top-3 w-16 h-16 bg-amber-50 rounded-full opacity-60" />
              <div className="relative flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">즐겨쓴 모듈</span>
                <div className="p-1.5 bg-amber-100 text-amber-600 rounded-lg">
                  <Award size={14} />
                </div>
              </div>
              <div className="relative">
                <p className="text-sm font-bold text-slate-800 truncate" title={stats.topModule || '—'}>
                  {stats.topModule ? getDisplayProgramName(stats.topModule) : '—'}
                </p>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5 tabular-nums">
                  {stats.topModuleCount}회 사용
                </p>
              </div>
            </div>
          </div>

          {/* 모듈별 사용 분포 — 우측 1/3 영역 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <BarChart3 size={14} className="text-slate-400" />
                <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">모듈별 사용</h3>
              </div>
              <span className="text-[10px] font-bold text-slate-400 tabular-nums">
                Top {Math.min(stats.moduleEntries.length, 5)}
              </span>
            </div>

            {stats.moduleEntries.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">집계할 데이터가 없습니다.</p>
            ) : (
              <div className="space-y-2.5">
                {stats.moduleEntries.slice(0, 5).map(([name, count], idx) => {
                  const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                  const color = MODULE_BAR_COLORS[idx % MODULE_BAR_COLORS.length];
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setProgramFilter(PROGRAM_FILTERS.includes(name) ? name : 'All')}
                      className="w-full group text-left cursor-pointer"
                      title={`${getDisplayProgramName(name)} — ${count}건 (${pct}%) — 클릭 시 필터`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-bold text-slate-600 truncate group-hover:text-blue-600 transition-colors">
                          {getDisplayProgramName(name)}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 tabular-nums shrink-0 ml-2">
                          {count}
                          <span className="text-slate-300 ml-1">({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-500 group-hover:opacity-80`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && stats.total > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 animate-fade-in-up">
          <button
            type="button"
            onClick={() => setFileStatusFilter('available')}
            className={`text-left bg-white rounded-xl border shadow-sm p-4 transition-colors cursor-pointer ${
              fileStatusFilter === 'available' ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">파일 보관 중</span>
              <FileOutput size={16} className="text-blue-500" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-slate-800">{stats.availableFiles}<span className="ml-1 text-xs text-slate-400">건</span></p>
          </button>
          <button
            type="button"
            onClick={() => setFileStatusFilter('expired')}
            className={`text-left bg-white rounded-xl border shadow-sm p-4 transition-colors cursor-pointer ${
              fileStatusFilter === 'expired' ? 'border-slate-400 ring-2 ring-slate-100' : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">파일 만료</span>
              <FileX size={16} className="text-slate-500" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-slate-800">{stats.expiredFiles}<span className="ml-1 text-xs text-slate-400">건</span></p>
          </button>
        </div>
      )}

      {/* 검색 / 필터 영역 */}
      <div className="flex flex-wrap items-center gap-2 mb-6 animate-fade-in-up">
        <div className="relative group flex-1 min-w-48 md:w-56">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
          <input
            type="text"
            placeholder="Search by Project or App..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-full shadow-sm transition-all"
          />
        </div>
        <select
          value={programFilter}
          onChange={(e) => setProgramFilter(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer"
        >
          {PROGRAM_FILTERS.map(f => <option key={f} value={f}>{f === 'All' ? 'All Apps' : getDisplayProgramName(f)}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer"
        >
          {STATUS_FILTERS.map(f => <option key={f} value={f}>{f === 'All' ? 'All Status' : f}</option>)}
        </select>
        <select
          value={fileStatusFilter}
          onChange={(e) => setFileStatusFilter(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer"
        >
          {FILE_STATUS_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <button onClick={() => fetchHistory()} className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors shadow-sm cursor-pointer">
          <Filter size={16} /> <span className="hidden sm:inline">Refresh</span>
        </button>
        <button
          type="button"
          onClick={() => setIsCompareOpen(true)}
          disabled={compareProjects.length !== 2}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
          title={compareProjects.length === 2 ? '선택한 실행 비교' : '비교할 프로젝트 2개를 선택하세요'}
        >
          <GitCompare size={16} />
          Run Compare
          {compareProjects.length > 0 && (
            <span className="rounded-full bg-blue-100 px-1.5 text-[10px] text-blue-700">{compareProjects.length}/2</span>
          )}
        </button>
        {fileStatusFilter !== 'All' && (
          <button
            onClick={() => setFileStatusFilter('All')}
            className="px-3 py-2 bg-slate-100 text-slate-500 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
          >
            파일 필터 해제
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-fade-in-up">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                <th className="py-4 pl-4 pr-2 font-semibold w-14 text-center">Compare</th>
                <th className="py-4 px-4 font-semibold w-16 text-center">No.</th>
                <th className="py-4 px-6 font-semibold">Project Name</th>
                <th className="py-4 px-6 font-semibold">App</th>
                <th className="py-4 px-6 font-semibold">Status</th>
                <th className="py-4 px-6 font-semibold">Files</th>
                <th className="py-4 px-6 font-semibold text-right">Date</th>
                <th className="py-4 px-4 font-semibold text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                    <td colSpan="8">
                    <FeedbackState
                      variant="loading"
                      title="Loading Data..."
                      message="해석 이력을 불러오는 중입니다."
                    />
                  </td>
                </tr>
              ) : paginatedProjects.length > 0 ? (
                paginatedProjects.map((project, index) => (
                  <tr 
                    key={project.id}
                    onClick={() => setSelectedProject(project)}
                    className="hover:bg-blue-50/50 transition-colors cursor-pointer group"
                  >
                    <td className="py-4 pl-4 pr-2 text-center">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleCompareProject(project);
                        }}
                        className="rounded-md p-1 text-slate-400 hover:bg-blue-100 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        aria-label={`${project.project_name} 비교 ${compareProjects.some(item => item.id === project.id) ? '선택 해제' : '선택'}`}
                      >
                        {compareProjects.some(item => item.id === project.id)
                          ? <CheckSquare size={17} className="text-blue-600" />
                          : <Square size={17} />}
                      </button>
                    </td>
                    <td className="py-4 px-4 font-mono text-xs text-slate-500 font-bold text-center">{(currentPage - 1) * PAGE_SIZE + index + 1}</td>
                    <td className="py-4 px-6">
                      <div className="flex items-center">
                        <div className="p-2 bg-slate-100 rounded text-slate-400 mr-3 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors"><Box size={18} /></div>
                        <p className="font-bold text-slate-700 text-sm group-hover:text-blue-700 transition-colors">{project.project_name || 'Unnamed Project'}</p>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-xs font-medium text-slate-600"><span className="inline-block bg-slate-100 px-2 py-1 rounded border border-slate-200 whitespace-nowrap max-w-[220px] truncate align-middle" title={project.program_name}>{getDisplayProgramName(project.program_name)}</span></td>
                    <td className="py-4 px-6">
                      <StatusBadge status={project.status} />
                    </td>
                    <td className="py-4 px-6"><FileRetentionBadge project={project} /></td>
                    <td className="py-4 px-6 text-xs text-slate-400 text-right font-mono">{new Date(project.created_at).toLocaleString()}</td>
                    <td className="py-4 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRerun(project);
                          }}
                          disabled={
                            rerunningIds.has(project.id)
                            || project.files_available === false
                            || !supportsProjectRerun(project)
                          }
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-35"
                          title={
                            project.files_available === false
                              ? '입력 파일 보관 기간이 만료되었습니다.'
                              : supportsProjectRerun(project)
                                ? '동일 입력으로 다시 실행'
                                : '이 앱은 저장 파일 기반 재실행을 지원하지 않습니다.'
                          }
                          aria-label={`${project.project_name} 동일 입력 재실행`}
                        >
                          {rerunningIds.has(project.id)
                            ? <RefreshCw size={16} className="animate-spin" />
                            : <Play size={16} />}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-blue-600"
                          title="프로젝트 상세"
                          aria-label={`${project.project_name} 상세 열기`}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                    <td colSpan="8">
                    <FeedbackState
                      icon={FileCode}
                      title="실행된 해석 이력이 없습니다."
                      message="필터 조건을 조정하거나 새 해석을 실행하면 이곳에 표시됩니다."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-2">
          <p className="text-xs text-slate-500">
            전체 <span className="font-bold text-slate-700">{totalCount}</span>건 중{' '}
            <span className="font-bold text-slate-700">
              {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, totalCount)}
            </span>건 표시
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className={`p-1.5 rounded-lg border text-sm transition-colors ${
                currentPage === 1
                  ? 'border-slate-200 text-gray-300 cursor-not-allowed'
                  : 'border-gray-300 text-slate-600 hover:bg-slate-100 cursor-pointer'
              }`}
            >
              <ChevronLeft size={16} />
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
              .reduce((acc, p, idx, arr) => {
                if (idx > 0 && p - arr[idx - 1] > 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((item, idx) =>
                item === '...' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-slate-400 text-sm">…</span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setCurrentPage(item)}
                    className={`w-8 h-8 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
                      currentPage === item
                        ? 'bg-brand-blue text-white'
                        : 'border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {item}
                  </button>
                )
              )}

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className={`p-1.5 rounded-lg border text-sm transition-colors ${
                currentPage === totalPages
                  ? 'border-slate-200 text-gray-300 cursor-not-allowed'
                  : 'border-gray-300 text-slate-600 hover:bg-slate-100 cursor-pointer'
              }`}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Detail Modal — Truss Assessment 은 결과 다운로드 전용 모달(Figure 07 레이아웃) */}
      {selectedProject?.program_name === 'Truss Assessment' ? (
        <AssessmentProjectModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onViewResultModel={() => setIsResultViewerOpen(true)}
        />
      ) : (
        <ProjectDetailModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onOpen3D={() => setIs3DViewerOpen(true)}
        />
      )}

      {/* 3D BDF Viewer Modal (모델 형상만) — 비-Truss Assessment / 비-HP-SCR 프로젝트용 */}
      <BdfViewerModal
        isOpen={is3DViewerOpen && !(selectedProject?.program_name?.startsWith('HP-SCR'))}
        project={selectedProject}
        onClose={() => setIs3DViewerOpen(false)}
      />

      {/* HP-SCR 배관해석 전용 3D Viewer (BdfModelViewer + pipeMode + JSON_ModelInfo) */}
      <HpScrViewerModal
        isOpen={is3DViewerOpen && !!(selectedProject?.program_name?.startsWith('HP-SCR'))}
        project={selectedProject}
        onClose={() => setIs3DViewerOpen(false)}
      />

      {/* Assessment Result Viewer Modal — Truss Assessment 결과를 모델 색상으로 시각화 */}
      <AssessmentResultViewerModal
        isOpen={isResultViewerOpen}
        project={selectedProject}
        onClose={() => setIsResultViewerOpen(false)}
      />

      <ProjectCompareModal
        projects={isCompareOpen ? compareProjects : []}
        onClose={() => setIsCompareOpen(false)}
      />

    </div>
  );
}
