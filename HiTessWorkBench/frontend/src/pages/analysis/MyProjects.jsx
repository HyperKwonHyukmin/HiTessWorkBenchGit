import React, { useState, useEffect } from 'react';
import { getAnalysisHistory, downloadFileBlob, exportAssessmentXlsx } from '../../api/analysis';
import { extractFilename } from '../../utils/fileHelper';
import {
  Search, Filter, Download, RefreshCw,
  ChevronRight, ChevronLeft, Box,
  CheckCircle2, XCircle, AlertCircle,
  FileCode, Database, FileOutput, Eye
} from 'lucide-react';

import BdfViewerModal from '../../components/modals/BdfViewerModal';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';
import { useToast } from '../../contexts/ToastContext';

// ==========================================
// 1. 상태 뱃지 헬퍼
// ==========================================
const StatusBadge = ({ status }) => {
  const styles = {
    Success: "bg-emerald-100 text-emerald-700 border-emerald-200",
    Failed: "bg-red-100 text-red-700 border-red-200",
    Pending: "bg-slate-100 text-slate-600 border-slate-200",
  };
  const icons = {
    Success: <CheckCircle2 size={12} className="mr-1" />,
    Failed: <XCircle size={12} className="mr-1" />,
    Pending: <AlertCircle size={12} className="mr-1" />,
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-bold border flex items-center w-fit ${styles[status] || styles.Pending}`}>
      {icons[status] || icons.Pending}
      {status}
    </span>
  );
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
        <p className="text-[10px] text-slate-400 truncate max-w-[300px]">{path}</p>
      </div>
    </div>
    <Download size={18} className="text-slate-300 group-hover:text-blue-600" />
  </button>
);

// ==========================================
// 3. 프로젝트 상세 모달 (공유 Modal 컴포넌트 사용)
// ==========================================
const ProjectDetailModal = ({ project, onClose, onOpen3D }) => {
  const [xlsxDownloading, setXlsxDownloading] = useState({});

  const handleDownload = async (filePath) => {
    if (!filePath) return;
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
      showToast('파일 다운로드에 실패했습니다.', 'error');
    }
  };

  const handleXlsxDownload = async (jsonPath, label) => {
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
    } catch {
      showToast('Excel 파일 생성에 실패했습니다.', 'error');
    } finally {
      setXlsxDownloading(prev => ({ ...prev, [label]: false }));
    }
  };

  const isAssessment = project?.program_name === 'Truss Assessment';

  // result_info 필터링: CSV_Error 제외, bdf key는 "BDF Model"로 표시
  const getResultLabel = (key) => {
    if (key === 'bdf') return 'BDF Model';
    return `${key.replace(/_/g, ' ')} Result`;
  };
  const filteredResultEntries = project?.result_info
    ? Object.entries(project.result_info).filter(([key]) =>
        key !== 'CSV_Error' && !(isAssessment && key.startsWith('Excel_'))
      )
    : [];
  const jsonFiles = filteredResultEntries.filter(([key]) => key.startsWith('JSON_'));

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
          </div>

          {/* 3D 시각화 버튼 */}
          {project.status === 'Success' && project.result_info?.bdf && (
            <button
              onClick={onOpen3D}
              className="w-full mb-6 py-4 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-center gap-3 text-indigo-700 font-bold hover:bg-indigo-100 transition-all duration-200 shadow-sm cursor-pointer group"
            >
              <Eye size={20} className="group-hover:scale-110 transition-transform" />
              과거 해석 모델 3D 시각화 실행
            </button>
          )}

          {/* Truss Assessment 결과 보고서 저장 */}
          {isAssessment && project.status === 'Success' && jsonFiles.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">결과 보고서 저장</h3>
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
                          <p className="text-[10px] text-slate-400">{isLoading ? 'Excel 파일 생성 중...' : '클릭하여 Excel 다운로드'}</p>
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
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <span className="text-xs text-slate-400 block mb-1">Module</span>
              <div className="font-bold text-slate-700 flex items-center gap-2">
                <Box size={16} className="text-blue-500"/> {project.program_name}
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
          <div className="space-y-2">
            {/* input_info: Truss Assessment는 bdf_model 입력 파일 숨김 */}
            {project.input_info && !isAssessment && project.program_name !== "Mast Post Assessment" &&
              Object.entries(project.input_info).map(([key, path]) => (
                typeof path === 'string'
                  ? <FileDownloadRow key={key} label={key.replace(/_/g, ' ')} path={path} icon={Database} onClick={() => handleDownload(path)} />
                  : null
              ))
            }
            {/* result_info: CSV_Error 제외, bdf → BDF Model */}
            {filteredResultEntries.map(([key, path]) => (
              typeof path === 'string'
                ? <FileDownloadRow key={key} label={getResultLabel(key)} path={path} icon={FileOutput} onClick={() => handleDownload(path)} isResult />
                : null
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
};

// ==========================================
// 4. 메인 MyProjects 페이지 컴포넌트
// ==========================================
const PROGRAM_FILTERS = ['All', 'TrussModelBuilder', 'Truss Assessment', 'Simple Beam Assessment'];
const STATUS_FILTERS = ['All', 'Success', 'Failed'];
const PAGE_SIZE = 10;

export default function MyProjects() {
  const { showToast } = useToast();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [programFilter, setProgramFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedProject, setSelectedProject] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  // 3D 뷰어 모달 상태
  const [is3DViewerOpen, setIs3DViewerOpen] = useState(false);

  const fetchHistory = async (signal) => {
    try {
      setLoading(true);
      const userStr = localStorage.getItem('user');
      const employeeId = userStr ? JSON.parse(userStr).employee_id : null;
      if (!employeeId) return;

      const response = await getAnalysisHistory(employeeId);
      if (signal?.aborted) return;
      setProjects(response.data?.items ?? response.data);
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'CanceledError') return;
      console.error("이력 불러오기 실패:", error);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchHistory(controller.signal);
    return () => controller.abort();
  }, []);

  // 필터 변경 시 첫 페이지로 리셋
  useEffect(() => { setCurrentPage(1); }, [searchTerm, programFilter, statusFilter]);

  const filteredProjects = projects.filter(p => {
    const matchesSearch = !searchTerm ||
      (p.project_name && p.project_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (p.program_name && p.program_name.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesProgram = programFilter === 'All' || p.program_name === programFilter;
    const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
    return matchesSearch && matchesProgram && matchesStatus;
  });

  const totalPages = Math.ceil(filteredProjects.length / PAGE_SIZE);
  const paginatedProjects = filteredProjects.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto pb-10">
      
      <PageHeader
        title="My Projects"
        icon={Database}
        subtitle="구조 해석 수행 이력 및 결과 파일을 관리합니다."
        accentColor="blue"
      />

      {/* 검색 / 필터 영역 */}
      <div className="flex flex-wrap items-center gap-2 mb-6 animate-fade-in-up">
        <div className="relative group flex-1 min-w-48 md:w-56">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
          <input
            type="text"
            placeholder="Search by Project or Module..."
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
          {PROGRAM_FILTERS.map(f => <option key={f} value={f}>{f === 'All' ? 'All Modules' : f}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer"
        >
          {STATUS_FILTERS.map(f => <option key={f} value={f}>{f === 'All' ? 'All Status' : f}</option>)}
        </select>
        <button onClick={() => fetchHistory()} className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors shadow-sm cursor-pointer">
          <Filter size={16} /> <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-fade-in-up">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                <th className="py-4 px-6 font-semibold w-20 text-center">No.</th>
                <th className="py-4 px-6 font-semibold">Project Name</th>
                <th className="py-4 px-6 font-semibold">Module</th>
                <th className="py-4 px-6 font-semibold">Status</th>
                <th className="py-4 px-6 font-semibold text-right">Date</th>
                <th className="py-4 px-6 font-semibold text-center w-16">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan="6" className="py-20 text-center text-slate-400">
                    <div className="animate-spin inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mb-4"></div>
                    <p className="text-sm font-bold">Loading Data...</p>
                  </td>
                </tr>
              ) : paginatedProjects.length > 0 ? (
                paginatedProjects.map((project) => (
                  <tr 
                    key={project.id}
                    onClick={() => setSelectedProject(project)}
                    className="hover:bg-blue-50/50 transition-colors cursor-pointer group"
                  >
                    <td className="py-4 px-6 font-mono text-xs text-slate-500 font-bold text-center">{project.id}</td>
                    <td className="py-4 px-6">
                      <div className="flex items-center">
                        <div className="p-2 bg-slate-100 rounded text-slate-400 mr-3 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors"><Box size={18} /></div>
                        <p className="font-bold text-slate-700 text-sm group-hover:text-blue-700 transition-colors">{project.project_name || 'Unnamed Project'}</p>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-xs font-medium text-slate-600"><span className="bg-slate-100 px-2 py-1 rounded border border-slate-200">{project.program_name}</span></td>
                    <td className="py-4 px-6"><StatusBadge status={project.status} /></td>
                    <td className="py-4 px-6 text-xs text-slate-400 text-right font-mono">{new Date(project.created_at).toLocaleString()}</td>
                    <td className="py-4 px-6 text-center"><button className="p-1.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-blue-600 transition-all"><ChevronRight size={18} /></button></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="py-20 text-center text-slate-400">
                    <FileCode size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">실행된 해석 이력이 없습니다.</p>
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
            전체 <span className="font-bold text-slate-700">{filteredProjects.length}</span>건 중{' '}
            <span className="font-bold text-slate-700">
              {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredProjects.length)}
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

      {/* Detail Modal */}
      <ProjectDetailModal
        project={selectedProject} 
        onClose={() => setSelectedProject(null)} 
        onOpen3D={() => setIs3DViewerOpen(true)} // ✅ 3D 뷰어 열기 함수 전달
      />

      {/* 3D BDF Viewer Modal */}
      <BdfViewerModal 
        isOpen={is3DViewerOpen} 
        project={selectedProject} 
        onClose={() => setIs3DViewerOpen(false)} 
      />

    </div>
  );
}