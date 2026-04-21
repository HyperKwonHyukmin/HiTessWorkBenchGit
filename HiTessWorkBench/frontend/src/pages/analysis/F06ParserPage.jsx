/// <summary>
/// F06 Parser — Nastran F06 파일에서 구조 해석 결과를 추출하는 페이지.
/// </summary>
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ArrowLeft, Upload, Play, Terminal, FileText, Download, History, ChevronDown, ChevronUp, ChevronsUpDown, BarChart2, ArrowUpRight, Search, FolderOpen } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import ChangelogModal from '../../components/ui/ChangelogModal';
import GuideButton from '../../components/ui/GuideButton';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { usePolling } from '../../hooks/usePolling';
import { requestF06Parser, downloadFileText, downloadFileBlob, getAnalysisById } from '../../api/analysis';
import { useToast } from '../../contexts/ToastContext';
import SolverCredit from '../../components/ui/SolverCredit';
import RelatedAppsWidget from '../../components/ui/RelatedAppsWidget';
import TransferBrowseModal from '../../components/ui/TransferBrowseModal';
import { useIncomingTransfer } from '../../hooks/useIncomingTransfer';

const LOG_COLORS = { success: 'text-green-400', error: 'text-red-400', warning: 'text-yellow-400', info: 'text-sky-400' };

const TABS = [
  { key: 'displacement', label: 'Displacement',  dataKey: 'displacements' },
  { key: 'spc_force',    label: 'SPC Force',      dataKey: 'spcForces' },
  { key: 'cbar_force',   label: 'CBAR Force',     dataKey: 'cbarForces' },
  { key: 'cbar_stress',  label: 'CBAR Stress',    dataKey: 'cbarStresses' },
  { key: 'cbeam_force',  label: 'CBEAM Force',    dataKey: 'cbeamForces' },
  { key: 'cbeam_stress', label: 'CBEAM Stress',   dataKey: 'cbeamStresses' },
  { key: 'crod_force',   label: 'CROD Force',     dataKey: 'crodForces' },
  { key: 'crod_stress',  label: 'CROD Stress',    dataKey: 'crodStresses' },
];

const MAX_DISPLAY_ROWS = 1000;

// ── 탭별 컬럼 정의 (JSON 키 → 표시 레이블) ──────────────────────────
const TAB_COL_DEFS = {
  spc_force:    [['pointId','NodeID'],['t1','Fx'],['t2','Fy'],['t3','Fz']],
  cbar_force:   [['elementId','ElemID'],['axialForce','Axial'],['bendMomentEndAPlane1','BendMomentA-1'],['bendMomentEndAPlane2','BendMomentA-2'],['bendMomentEndBPlane1','BendMomentB-1'],['bendMomentEndBPlane2','BendMomentB-2'],['shearPlane1','ShearPlane-1'],['shearPlane2','ShearPlane-2'],['torque','Torque']],
  cbar_stress:  null,
  cbeam_force:  [['elementId','ElemID'],['gridId','GridID'],['end','End'],['axialForce','Axial'],['bendMomentPlane1','BendMoment-1'],['bendMomentPlane2','BendMoment-2'],['shearPlane1','ShearPlane-1'],['shearPlane2','ShearPlane-2'],['totalTorque','TotalTorque'],['warpingTorque','WarpTorque']],
  cbeam_stress: [['elementId','ElemID'],['gridId','GridID'],['end','End'],['sMax','S Max'],['sMin','S Min']],
  crod_force:   [['elementId','ElemID'],['axialForce','Axial'],['torque','Torque']],
  crod_stress:  [['elementId','ElemID'],['axialStress','Axial Stress'],['torsionalStress','Torsional']],
};
const INT_DISPLAY_COLS = new Set(['NodeID', 'ElemID', 'GridID']);

function transformRow(row, tabKey) {
  if (tabKey === 'displacement') {
    const x = row.t1 ?? 0, y = row.t2 ?? 0, z = row.t3 ?? 0;
    return { NodeID: parseInt(row.pointId, 10), X: x, Y: y, Z: z, Total: Math.sqrt(x*x + y*y + z*z) };
  }
  if (tabKey === 'cbar_stress') {
    const saMax = row.saMax ?? 0, saMin = row.saMin ?? 0;
    const sbMax = row.sbMax ?? 0, sbMin = row.sbMin ?? 0;
    return {
      ElemID: parseInt(row.elementId, 10),
      'Axial Stress': row.axialStress ?? null,
      'SA-Stress': Math.abs(saMax) >= Math.abs(saMin) ? saMax : saMin,
      'SB-Stress': Math.abs(sbMax) >= Math.abs(sbMin) ? sbMax : sbMin,
    };
  }
  const defs = TAB_COL_DEFS[tabKey];
  if (!defs) return row;
  const out = {};
  for (const [jsonKey, label] of defs) {
    const val = row[jsonKey] ?? null;
    out[label] = (val !== null && INT_DISPLAY_COLS.has(label)) ? parseInt(val, 10) : val;
  }
  return out;
}

// ── Subcase별 차트 메트릭 설정 ────────────────────────────────────────
const CHART_CONFIG = {
  displacement: { metricFn: r => r['Total'] ?? 0,                                                                  idKey: 'NodeID', label: 'Total Disp.' },
  spc_force:    { metricFn: r => Math.sqrt(((r['Fx']??0)**2)+((r['Fy']??0)**2)+((r['Fz']??0)**2)),                idKey: 'NodeID', label: '|Force|' },
  cbar_stress:  { metricFn: r => Math.max(Math.abs(r['SA-Stress']??0), Math.abs(r['SB-Stress']??0)),               idKey: 'ElemID', label: 'Max Stress' },
  cbar_force:   { metricFn: r => Math.abs(r['Axial']??0),                                                          idKey: 'ElemID', label: '|Axial|' },
  cbeam_stress: { metricFn: r => Math.max(Math.abs(r['S Max']??0), Math.abs(r['S Min']??0)),                       idKey: 'ElemID', label: 'Max Stress' },
  cbeam_force:  { metricFn: r => Math.abs(r['Axial']??0),                                                          idKey: 'ElemID', label: '|Axial|' },
  crod_stress:  { metricFn: r => Math.abs(r['Axial Stress']??0),                                                   idKey: 'ElemID', label: '|Axial Stress|' },
  crod_force:   { metricFn: r => Math.abs(r['Axial']??0),                                                          idKey: 'ElemID', label: '|Axial|' },
};

function filterSpcZeros(rows) {
  return rows.filter(r =>
    Math.abs(r['Fx'] ?? 0) > 1e-10 ||
    Math.abs(r['Fy'] ?? 0) > 1e-10 ||
    Math.abs(r['Fz'] ?? 0) > 1e-10
  );
}

export default function F06ParserPage() {
  const { showToast } = useToast();
  const { setCurrentMenu } = useNavigation();
  const { startGlobalJob } = useDashboard();
  const { incomingTransfer, clearPendingJobTransfer } = useIncomingTransfer('F06 Parser');
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [idLookupOpen, setIdLookupOpen] = useState(false);
  const [lookupId, setLookupId] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);

  const [f06File, setF06File] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [logs, setLogs] = useState([]);
  const [currentPollingJobId, setCurrentPollingJobId] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const [resultData, setResultData] = useState(null);
  const [resultInfo, setResultInfo] = useState(null);
  const [selectedSubcase, setSelectedSubcase] = useState(null);
  const [activeTab, setActiveTab] = useState('displacement');
  const [sortConfig, setSortConfig] = useState({ key: null, dir: 'asc' });
  const [showCharts, setShowCharts] = useState(true);

  const fileInputRef = useRef(null);
  const logEndRef = useRef(null);
  const lastMsgRef = useRef('');

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const addLog = (message, type = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message, type }]);
  };

  usePolling({
    jobId: currentPollingJobId,
    maxRetries: 160,
    onProgress: (data) => {
      const { progress: p, message } = data;
      setProgress(p);
      if (message !== lastMsgRef.current) {
        lastMsgRef.current = message;
        setStatusMessage(message);
        setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message: `[${p}%] ${message}`, type: 'warning' }]);
      }
    },
    onComplete: async (data) => {
      setCurrentPollingJobId(null);
      setIsRunning(false);
      setProgress(100);
      setStatusMessage('파싱 완료');
      addLog('F06 파싱 완료.', 'success');

      const { engine_log, project } = data;
      if (engine_log) addLog(`[SOLVER] ${engine_log.trim()}`, 'info');
      if (!project?.result_info) {
        addLog('[경고] 결과 파일을 찾을 수 없습니다.', 'error');
        return;
      }

      const ri = project.result_info;
      setResultInfo(ri);

      if (ri.json_results) {
        try {
          addLog('JSON 결과 로드 중...', 'info');
          const res = await downloadFileText(ri.json_results);
          const parsed = JSON.parse(res.data);
          setResultData(parsed);
          if (parsed.subcases?.length > 0) {
            setSelectedSubcase(parsed.subcases[0].subcaseId);
            const counts = parsed.subcases.map(sc =>
              TABS.map(t => `${t.label}:${sc[t.dataKey]?.length ?? 0}`).join(', ')
            );
            parsed.subcases.forEach((sc, i) => {
              addLog(`[SUBCASE ${sc.subcaseId}] ${counts[i]}`, 'success');
            });
          }
        } catch {
          addLog('[오류] JSON 결과 파일 로드 실패.', 'error');
        }
      }
    },
    onError: (errData) => {
      setCurrentPollingJobId(null);
      setIsRunning(false);
      const msg = errData?.timeout ? '시간 초과 (2분). 파일 크기를 확인하세요.' : '파싱 실패.';
      addLog(msg, 'error');
    },
  });

  // 탭·Subcase 변경 시 정렬 초기화
  useEffect(() => { setSortConfig({ key: null, dir: 'asc' }); }, [activeTab, selectedSubcase]);

  const handleFile = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.f06')) {
      showToast('F06 파일만 업로드 가능합니다.', 'warning');
      return;
    }
    setF06File(file);
    setResultData(null);
    setResultInfo(null);
    setSelectedSubcase(null);
    setActiveTab('displacement');
    setSortConfig({ key: null, dir: 'asc' });
    setLogs([{ time: new Date().toLocaleTimeString(), message: `[FILE] ${file.name} 선택됨.`, type: 'info' }]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleLoadFromTransfer = async (filePath, andRun = true) => {
    try {
      const filename = filePath.split(/[\\/]/).pop();
      const res = await downloadFileBlob(filePath);
      const file = new File([res.data], filename, { type: 'text/plain' });
      handleFile(file);
      showToast(`${filename} 불러오기 완료`, 'success');
      if (andRun) runParse(file);
    } catch {
      showToast('F06 파일 불러오기 실패', 'error');
    }
  };

  const handleIdLookup = async () => {
    if (!lookupId) return;
    setIsLookingUp(true);
    try {
      const res = await getAnalysisById(lookupId);
      const f06Path = res.data.result_info?.f06;
      if (!f06Path) {
        showToast('해당 분석에 F06 파일이 없습니다.', 'warning');
        return;
      }
      await handleLoadFromTransfer(f06Path);
      setIdLookupOpen(false);
      setLookupId('');
    } catch {
      showToast(`Analysis #${lookupId}를 찾을 수 없습니다.`, 'error');
    } finally {
      setIsLookingUp(false);
    }
  };

  const runParse = async (fileOverride) => {
    const fileToUse = fileOverride ?? f06File;
    if (!fileToUse || isRunning) return;
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('서버 요청 중...');
    setResultData(null);
    setResultInfo(null);
    setSelectedSubcase(null);
    setActiveTab('displacement');
    setLogs([]);
    lastMsgRef.current = '';

    const userStr = localStorage.getItem('user');
    const employeeId = userStr ? JSON.parse(userStr).employee_id : 'guest';

    const formData = new FormData();
    formData.append('f06_file', fileToUse);
    formData.append('employee_id', employeeId);
    formData.append('source', 'Workbench');

    try {
      const res = await requestF06Parser(formData);
      const jobId = res.data.job_id;
      addLog(`[JOB] 작업 큐 등록 완료. (Job ID: ${jobId})`, 'success');
      startGlobalJob?.(jobId, 'F06 Parser');
      setCurrentPollingJobId(jobId);
    } catch {
      setIsRunning(false);
      addLog('서버 요청 실패.', 'error');
    }
  };

  const handleCsvDownload = async () => {
    if (!resultInfo || selectedSubcase == null) return;
    const csvKey = `csv_SC${selectedSubcase}_${activeTab}`;
    const csvPath = resultInfo[csvKey];
    if (!csvPath) {
      showToast('해당 탭의 CSV 파일이 없습니다.', 'warning');
      return;
    }
    try {
      const res = await downloadFileBlob(csvPath);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = csvPath.split(/[\\/]/).pop();
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('CSV 다운로드 실패.', 'error');
    }
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSort = (col) => {
    setSortConfig(prev => ({
      key: col,
      dir: prev.key === col && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  };

  // 현재 Subcase 및 탭 데이터
  const currentTabConfig = TABS.find(t => t.key === activeTab);
  const currentSubcase = resultData?.subcases?.find(sc => sc.subcaseId === selectedSubcase);
  const rawRows = currentSubcase?.[currentTabConfig?.dataKey] ?? [];

  const currentRows = useMemo(() => {
    let rows = rawRows.map(r => transformRow(r, activeTab));
    if (activeTab === 'spc_force') rows = filterSpcZeros(rows);
    return rows;
  }, [rawRows, activeTab]);

  const chartCfg = CHART_CONFIG[activeTab];

  const topRanking = useMemo(() => {
    if (!chartCfg || currentRows.length === 0) return [];
    return [...currentRows]
      .sort((a, b) => chartCfg.metricFn(b) - chartCfg.metricFn(a))
      .slice(0, 10)
      .map(r => ({ id: String(r[chartCfg.idKey] ?? '?'), value: chartCfg.metricFn(r) }));
  }, [currentRows, activeTab]);

  const subcaseTrend = useMemo(() => {
    if (!resultData || !chartCfg) return [];
    const tabDef = TABS.find(t => t.key === activeTab);
    if (!tabDef) return [];
    return resultData.subcases.map(sc => {
      let rows = (sc[tabDef.dataKey] ?? []).map(r => transformRow(r, activeTab));
      if (activeTab === 'spc_force') rows = filterSpcZeros(rows);
      const maxVal = rows.length > 0 ? Math.max(...rows.map(r => chartCfg.metricFn(r))) : 0;
      return { label: `SC${sc.subcaseId}`, value: maxVal, id: sc.subcaseId };
    });
  }, [resultData, activeTab]);

  const sortedRows = useMemo(() => {
    if (!sortConfig.key) return currentRows;
    return [...currentRows].sort((a, b) => {
      const va = a[sortConfig.key], vb = b[sortConfig.key];
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sortConfig.dir === 'asc' ? cmp : -cmp;
    });
  }, [currentRows, sortConfig]);

  const displayRows = sortedRows.slice(0, MAX_DISPLAY_ROWS);
  const columns = displayRows.length > 0 ? Object.keys(displayRows[0]) : [];

  const hasCsvForCurrentTab = !!(resultInfo && selectedSubcase != null && resultInfo[`csv_SC${selectedSubcase}_${activeTab}`]);

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6 relative">
      {/* 그라디언트 배너 헤더 */}
      <div className="relative -mx-6 -mt-6 mb-6 px-8 py-5 bg-gradient-to-r from-indigo-900 via-indigo-800 to-indigo-700 overflow-hidden shrink-0">
        <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true">
          <div className="absolute -right-6 -top-6 w-48 h-48 bg-white rounded-full" />
          <div className="absolute right-24 bottom-0 w-24 h-24 bg-white rounded-full" />
        </div>
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentMenu('Productivity Apps')}
              className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <FileText size={18} className="text-indigo-300" />
                F06 Parser
              </h1>
              <p className="text-sm text-indigo-200/80 mt-0.5">Nastran SOL 101 F06 결과 추출 및 조회</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setChangelogOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-medium transition-colors cursor-pointer">
              <History size={14} /> 이력
            </button>
            <GuideButton guideTitle="[생산성] F06 Parser — F06 결과 추출" variant="dark" />
          </div>
        </div>
      </div>

      {/* 적용 범위 안내 배지 */}
      <div className="flex items-center gap-2 -mt-2 mb-3 px-1 shrink-0">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
          현재 버전은 SOL 101 정적 해석의 1D Beam 요소 (CBAR / CBEAM / CROD) 결과에 한하여 지원됩니다.
        </span>
      </div>

      {/* 본문: 좌우 분할 */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* 왼쪽 사이드바 */}
        <div className="w-[300px] shrink-0 flex flex-col gap-4">
          {/* BDF Scanner 인계 배너 */}
          {incomingTransfer && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <ArrowUpRight size={13} className="text-indigo-600 shrink-0" />
                <p className="text-xs font-bold text-indigo-700">BDF Scanner 결과 감지</p>
              </div>
              <p className="text-[10px] text-indigo-500 mb-3 truncate pl-5">{incomingTransfer.projectName}</p>
              <div className="flex gap-2 pl-5">
                <button
                  onClick={() => {
                    handleLoadFromTransfer(incomingTransfer.filePath);
                    clearPendingJobTransfer();
                  }}
                  className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors"
                >
                  불러오기 &amp; 파싱
                </button>
                <button
                  onClick={clearPendingJobTransfer}
                  className="px-3 py-1.5 border border-indigo-200 text-indigo-400 hover:text-indigo-600 hover:border-indigo-300 text-xs rounded-lg cursor-pointer transition-colors"
                >
                  무시
                </button>
              </div>
            </div>
          )}

          {/* 파일 업로드 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-700 to-indigo-600 px-5 py-3">
              <p className="text-xs font-bold text-white uppercase tracking-widest">F06 파일 선택</p>
            </div>
            <div className="p-5">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  isDragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'
                }`}
              >
                <Upload size={28} className="mx-auto mb-2 text-slate-400" />
                {f06File ? (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 truncate">{f06File.name}</p>
                    <p className="text-xs text-slate-400 mt-1">{formatBytes(f06File.size)}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-slate-500">클릭하거나 파일을 드래그하세요</p>
                    <p className="text-xs text-slate-400 mt-1">.f06</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".f06"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />

              {/* 실행 버튼 */}
              <button
                onClick={() => runParse()}
                disabled={!f06File || isRunning}
                className={`mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-sm transition-all ${
                  !f06File || isRunning
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow-md cursor-pointer'
                }`}
              >
                <Play size={15} />
                {isRunning ? '파싱 중...' : '파싱 실행'}
              </button>

              {/* 이전 분석 결과 불러오기 */}
              <div className="mt-4 border-t border-slate-100 pt-3">
                <button
                  onClick={() => setIdLookupOpen(o => !o)}
                  className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-600 cursor-pointer transition-colors"
                >
                  <span>이전 분석 결과 불러오기</span>
                  <ChevronDown size={13} className={`transition-transform duration-200 ${idLookupOpen ? 'rotate-180' : ''}`} />
                </button>
                {idLookupOpen && (
                  <div className="mt-2.5 space-y-2">
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        value={lookupId}
                        onChange={e => setLookupId(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleIdLookup()}
                        placeholder="Analysis ID"
                        className="flex-1 text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400 min-w-0"
                      />
                      <button
                        onClick={handleIdLookup}
                        disabled={!lookupId || isLookingUp}
                        className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-800 disabled:opacity-40 text-white text-xs rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                      >
                        {isLookingUp ? '...' : '불러오기'}
                      </button>
                    </div>
                    <button
                      onClick={() => setBrowseOpen(true)}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 text-xs rounded-lg cursor-pointer transition-colors"
                    >
                      <FolderOpen size={12} />
                      찾아보기
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 진행률 */}
          {(isRunning || progress > 0) && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-600">진행률</span>
                <span className="text-xs font-bold text-indigo-600">{progress}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {statusMessage && (
                <p className="text-xs text-slate-500 mt-2 truncate">{statusMessage}</p>
              )}
            </div>
          )}

          {/* 터미널 로그 */}
          <div className="bg-slate-900 rounded-2xl border border-slate-700 shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border-b border-slate-700 shrink-0">
              <Terminal size={13} className="text-slate-400" />
              <span className="text-xs font-mono text-slate-400 font-semibold">PARSER LOG</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-5 min-h-[120px]">
              {logs.length === 0 ? (
                <p className="text-slate-600">F06 파일을 업로드하고 파싱을 실행하세요.</p>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-slate-600 shrink-0">{log.time}</span>
                    <span className={LOG_COLORS[log.type] ?? 'text-slate-300'}>{log.message}</span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>

          <RelatedAppsWidget appTitle="F06 Parser" />
          <SolverCredit contributor="권혁민" />
        </div>

        {/* 오른쪽 결과 영역 */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {!resultData ? (
            <div className="flex-1 flex items-center justify-center bg-white rounded-2xl border border-slate-200 shadow-sm">
              <div className="text-center text-slate-400">
                <FileText size={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">F06 파일을 업로드하고 파싱하면</p>
                <p className="text-sm">결과가 여기에 표시됩니다.</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {/* 상단 컨트롤 바 */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50 shrink-0 gap-3 flex-wrap">
                {/* Subcase 드롭다운 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Subcase</span>
                  <div className="relative">
                    <select
                      value={selectedSubcase ?? ''}
                      onChange={(e) => setSelectedSubcase(Number(e.target.value))}
                      className="appearance-none pl-3 pr-7 py-1.5 text-sm font-medium border border-slate-200 rounded-lg bg-white text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                      {resultData.subcases.map(sc => (
                        <option key={sc.subcaseId} value={sc.subcaseId}>
                          Subcase {sc.subcaseId}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
                  <span className="text-xs text-slate-400">
                    ({resultData.subcases.length}개 케이스)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* 차트 토글 */}
                  <button
                    onClick={() => setShowCharts(v => !v)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      showCharts
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-indigo-50'
                    }`}
                  >
                    <BarChart2 size={13} />
                    통계 차트
                  </button>
                  {/* CSV 다운로드 */}
                  <button
                    onClick={handleCsvDownload}
                    disabled={!hasCsvForCurrentTab}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      hasCsvForCurrentTab
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <Download size={13} />
                    CSV 다운로드
                  </button>
                </div>
              </div>

              {/* 탭 바 */}
              <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-slate-100 overflow-x-auto shrink-0">
                {TABS.map(tab => {
                  const count = currentSubcase?.[tab.dataKey]?.length ?? 0;
                  const isActive = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => count > 0 && setActiveTab(tab.key)}
                      disabled={count === 0}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : count > 0
                            ? 'bg-white text-slate-600 hover:bg-indigo-50 border border-slate-200'
                            : 'bg-slate-50 text-slate-300 border border-slate-100 cursor-default'
                      }`}
                    >
                      {tab.label}
                      {count > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                          isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 통계 차트 패널 */}
              {showCharts && chartCfg && (
                <div className="shrink-0 border-b border-slate-100 bg-slate-50/60 px-4 py-3 grid grid-cols-[45%_55%] gap-3" style={{ height: 210 }}>
                  {/* 좌: 상위 10개 요소 랭킹 */}
                  <div className="flex flex-col min-w-0">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      상위 10개 — Subcase {selectedSubcase} ({chartCfg.label})
                    </p>
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart layout="vertical" data={topRanking} margin={{ top: 2, right: 12, bottom: 2, left: 8 }}>
                          <YAxis dataKey="id" type="category" tick={{ fontSize: 9, fill: '#64748b' }} width={48} />
                          <XAxis type="number" tick={{ fontSize: 8, fill: '#94a3b8' }} tickFormatter={v => v.toExponential(1)} />
                          <Tooltip
                            formatter={(v) => [v.toExponential(4), chartCfg.label]}
                            contentStyle={{ fontSize: 11, padding: '4px 8px' }}
                          />
                          <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={14}>
                            {topRanking.map((_, i) => (
                              <Cell key={i} fill={i === 0 ? '#4f46e5' : i < 3 ? '#818cf8' : '#c7d2fe'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 우: Subcase별 최대값 추세 */}
                  <div className="flex flex-col min-w-0">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Subcase별 최대 {chartCfg.label} 추세
                    </p>
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={subcaseTrend} margin={{ top: 2, right: 8, bottom: 2, left: 8 }}>
                          <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#64748b' }} />
                          <YAxis tick={{ fontSize: 8, fill: '#94a3b8' }} tickFormatter={v => v.toExponential(1)} width={52} />
                          <Tooltip
                            formatter={(v) => [v.toExponential(4), chartCfg.label]}
                            contentStyle={{ fontSize: 11, padding: '4px 8px' }}
                          />
                          <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={32}>
                            {subcaseTrend.map((entry, i) => (
                              <Cell key={i} fill={entry.id === selectedSubcase ? '#4f46e5' : '#c7d2fe'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}

              {/* 테이블 */}
              <div className="flex-1 overflow-auto">
                {displayRows.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
                    이 Subcase에 {currentTabConfig?.label} 데이터가 없습니다.
                  </div>
                ) : (
                  <>
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-100 border-b border-slate-200">
                          <th className="px-3 py-2 text-left font-semibold text-slate-500 w-12 text-[11px]">#</th>
                          {columns.map(col => {
                            const isSorted = sortConfig.key === col;
                            return (
                              <th
                                key={col}
                                onClick={() => handleSort(col)}
                                className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap cursor-pointer hover:bg-slate-200 select-none transition-colors"
                              >
                                <div className="flex items-center gap-1">
                                  {col}
                                  {isSorted
                                    ? sortConfig.dir === 'asc'
                                      ? <ChevronUp size={11} className="text-indigo-500" />
                                      : <ChevronDown size={11} className="text-indigo-500" />
                                    : <ChevronsUpDown size={11} className="text-slate-300" />
                                  }
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {displayRows.map((row, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                            <td className="px-3 py-1.5 text-slate-400 font-mono text-[11px]">{i + 1}</td>
                            {columns.map(col => {
                              const val = row[col];
                              return (
                                <td key={col} className="px-3 py-1.5 text-slate-700 font-mono whitespace-nowrap">
                                  {val == null
                                    ? <span className="text-slate-300">—</span>
                                    : typeof val === 'number'
                                      ? INT_DISPLAY_COLS.has(col) ? String(val) : val.toExponential(4)
                                      : String(val)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {currentRows.length > MAX_DISPLAY_ROWS && (
                      <div className="px-4 py-3 bg-amber-50 border-t border-amber-200 text-xs text-amber-700 flex items-center gap-2">
                        <span>처음 {MAX_DISPLAY_ROWS}행만 표시됩니다.</span>
                        <span className="text-amber-500">전체 {currentRows.length}행은 CSV 다운로드를 이용하세요.</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <TransferBrowseModal
        isOpen={browseOpen}
        onClose={() => setBrowseOpen(false)}
        targetApp="F06 Parser"
        onSelect={({ filePath }) => handleLoadFromTransfer(filePath)}
      />
      <ChangelogModal
        programKey="F06Parser"
        title="F06 Parser"
        isOpen={changelogOpen}
        onClose={() => setChangelogOpen(false)}
      />
    </div>
  );
}
