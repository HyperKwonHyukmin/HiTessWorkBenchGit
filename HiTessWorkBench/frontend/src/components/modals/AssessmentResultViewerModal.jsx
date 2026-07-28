/// <summary>
/// 과거 Truss Assessment 프로젝트의 결과(BDF + JSON)를 받아 모델 위에
/// Assessment 결과 색상을 입혀 보여주는 전체 화면 뷰어 모달.
/// 내부에서 AssessmentBdfViewer 를 그대로 재사용하여 TrussAssessment 3D Preview 와
/// 동일한 시각화 경험을 제공한다.
/// </summary>
import React, { useState, useEffect, Fragment, useMemo } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  X,
  Box,
  RefreshCw,
  FileX,
  Search,
  PanelRightClose,
  PanelRightOpen,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { downloadFileText, downloadFileBlob } from '../../api/analysis';
import AssessmentBdfViewer from '../analysis/AssessmentBdfViewer';

// Nastran 부동소수 파서 (BdfViewerModal 와 동일 패턴)
const parseNastranFloat = (str) => {
  if (!str || !str.trim()) return 0;
  let s = str.trim().toUpperCase().replace(/,/g, '').replace('D', 'E');
  if (s.includes('E')) {
    const val = parseFloat(s);
    return isNaN(val) ? 0 : val;
  }
  s = s.replace(/([0-9\.])([+-][0-9]+)$/, '$1E$2');
  const val = parseFloat(s);
  return isNaN(val) ? 0 : val;
};

// AssessmentBdfViewer 가 기대하는 [n1, n2, eid] 형식으로 파싱.
const parseBDF = (bdfText) => {
  const nodes = {};
  const elements = [];
  const lines = bdfText.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trimEnd();
    if (!line || line.startsWith('$')) continue;

    if (line.startsWith('GRID')) {
      const isCsv = line.includes(',') && line.split(',').length > 3;
      if (isCsv) {
        const p = line.split(',');
        const id = parseInt(p[1]);
        if (!isNaN(id)) nodes[id] = [parseNastranFloat(p[3]), parseNastranFloat(p[4]), parseNastranFloat(p[5])];
      } else if (line.startsWith('GRID*')) {
        const padded = line.padEnd(72, ' ');
        const id = parseInt(padded.substring(8, 24));
        const x = parseNastranFloat(padded.substring(40, 56));
        const y = parseNastranFloat(padded.substring(56, 72));
        let z = 0;
        const next = lines[i + 1] ? lines[i + 1].trimEnd() : '';
        if (next.startsWith('*')) {
          z = parseNastranFloat(next.padEnd(24, ' ').substring(8, 24));
          i++;
        }
        if (!isNaN(id)) nodes[id] = [x, y, z];
      } else {
        const padded = line.padEnd(48, ' ');
        let id = parseInt(padded.substring(8, 16));
        let x = parseNastranFloat(padded.substring(24, 32));
        let y = parseNastranFloat(padded.substring(32, 40));
        let z = parseNastranFloat(padded.substring(40, 48));
        if (isNaN(id) || isNaN(x) || isNaN(y) || isNaN(z)) {
          const tokens = line.trim().split(/\s+/);
          if (tokens.length >= 5 && tokens[0] === 'GRID') {
            id = parseInt(tokens[1]);
            z = parseNastranFloat(tokens[tokens.length - 1]);
            y = parseNastranFloat(tokens[tokens.length - 2]);
            x = parseNastranFloat(tokens[tokens.length - 3]);
          }
        }
        if (!isNaN(id)) nodes[id] = [x, y, z];
      }
    } else if (line.startsWith('CROD') || line.startsWith('CBAR') || line.startsWith('CBEAM')) {
      const isCsv = line.includes(',') && line.split(',').length > 3;
      if (isCsv) {
        const p = line.split(',');
        const eid = parseInt(p[1]);
        const n1 = parseInt(p[3]);
        const n2 = parseInt(p[4]);
        if (!isNaN(n1) && !isNaN(n2)) elements.push([n1, n2, isNaN(eid) ? null : eid]);
      } else if (line.startsWith('CROD*') || line.startsWith('CBAR*') || line.startsWith('CBEAM*')) {
        const padded = line.padEnd(72, ' ');
        const eid = parseInt(padded.substring(8, 24));
        const n1 = parseInt(padded.substring(40, 56));
        const n2 = parseInt(padded.substring(56, 72));
        if (!isNaN(n1) && !isNaN(n2)) elements.push([n1, n2, isNaN(eid) ? null : eid]);
      } else {
        const padded = line.padEnd(40, ' ');
        let eid = parseInt(padded.substring(8, 16));
        let n1 = parseInt(padded.substring(24, 32));
        let n2 = parseInt(padded.substring(32, 40));
        if (isNaN(n1) || isNaN(n2)) {
          const tokens = line.trim().split(/\s+/);
          if (tokens.length >= 5) {
            eid = parseInt(tokens[1]);
            n1 = parseInt(tokens[3]);
            n2 = parseInt(tokens[4]);
          }
        }
        if (!isNaN(n1) && !isNaN(n2)) elements.push([n1, n2, isNaN(eid) ? null : eid]);
      }
    }
  }

  return { nodes, elements };
};

export default function AssessmentResultViewerModal({ isOpen, project, onClose }) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [nodes, setNodes] = useState({});
  const [elements, setElements] = useState([]);
  const [resultsMap, setResultsMap] = useState({});
  const [activeCase, setActiveCase] = useState(null);
  const [viewerState, setViewerState] = useState({
    activeLoadCaseIndex: -1,
    activeLoadCaseLabel: 'Envelope',
    assessmentMap: {},
  });
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [elementQuery, setElementQuery] = useState('');
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);

  useEffect(() => {
    if (!isOpen) {
      setLoading(false);
      setErrorMessage('');
      setNodes({});
      setElements([]);
      setResultsMap({});
      setActiveCase(null);
      setViewerState({ activeLoadCaseIndex: -1, activeLoadCaseLabel: 'Envelope', assessmentMap: {} });
      setSelectedElementId(null);
      setElementQuery('');
      return;
    }
    if (!project?.result_info?.bdf) {
      setErrorMessage('BDF 파일이 없는 해석입니다.');
      return;
    }
    if (project.files_available === false) {
      setErrorMessage('파일 없음');
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setErrorMessage('');
      try {
        // 1) BDF 다운로드 & 파싱
        const bdfRes = await downloadFileText(project.result_info.bdf);
        if (cancelled) return;
        const { nodes: nMap, elements: eList } = parseBDF(bdfRes.data);
        setNodes(nMap);
        setElements(eList);

        // 2) JSON_* 결과 파일들 다운로드 & 파싱
        const jsonEntries = Object.entries(project.result_info).filter(
          ([k, v]) => k.startsWith('JSON_') && typeof v === 'string'
        );
        const map = {};
        await Promise.all(jsonEntries.map(async ([key, path]) => {
          const caseName = key.replace(/^JSON_/i, '');
          try {
            const res = await downloadFileBlob(path);
            const text = await res.data.text();
            map[caseName] = JSON.parse(text);
          } catch (e) {
            console.error('결과 JSON 로드 실패:', path, e);
          }
        }));
        if (cancelled) return;
        setResultsMap(map);
        const first = Object.keys(map)[0] || null;
        setActiveCase(first);
      } catch (err) {
        if (cancelled) return;
        if (err?.response?.status === 404) setErrorMessage('파일 없음');
        else {
          console.error('Result viewer load error:', err);
          setErrorMessage('결과 모델을 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [isOpen, project]);

  const caseNames = Object.keys(resultsMap);
  const allAssessmentRows = useMemo(() => (
    Object.entries(viewerState.assessmentMap || {})
      .map(([element, value]) => ({
        element,
        assessment: Number(value?.assessment) || 0,
        result: value?.result || ((Number(value?.assessment) || 0) >= 1 ? 'FAIL' : 'OK'),
      }))
      .sort((a, b) => b.assessment - a.assessment)
  ), [viewerState.assessmentMap]);
  const assessmentRows = useMemo(() => (
    allAssessmentRows.filter(
      row => !elementQuery.trim() || String(row.element).includes(elementQuery.trim()),
    )
  ), [allAssessmentRows, elementQuery]);
  const selectedRow = allAssessmentRows.find(
    row => String(row.element) === String(selectedElementId),
  );
  const failedCount = allAssessmentRows.filter(
    row => row.assessment >= 1 || row.result === 'FAIL',
  ).length;
  const maxAssessment = allAssessmentRows[0]?.assessment ?? 0;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm" />
        <div className="fixed inset-0 flex items-center justify-center p-6">
          <Dialog.Panel className="w-full h-full bg-slate-900 rounded-2xl flex border border-slate-700 overflow-hidden shadow-2xl relative">
            <div className="relative min-w-0 flex-1">

            {/* 헤더 */}
            <div className="absolute top-4 left-6 z-30 pointer-events-none flex flex-col gap-1">
              <h3 className="text-brand-accent font-bold tracking-widest text-xl drop-shadow-md flex items-center gap-2">
                <Box size={24} className="text-white" /> Assessment Result Viewer
              </h3>
              <p className="text-slate-300 text-xs font-mono bg-black/50 px-2 py-1 rounded w-fit mt-1">
                {project?.project_name || 'Unnamed'} | Nodes: {Object.keys(nodes).length} / Elements: {elements.length}
              </p>
            </div>

            {!isInspectorOpen && (
              <div className="absolute right-4 top-4 z-40 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsInspectorOpen(true)}
                  className="rounded-lg border border-slate-700 bg-slate-900/85 p-2 text-slate-300 hover:border-blue-500 hover:text-white"
                  title="결과 인스펙터 열기"
                >
                  <PanelRightOpen size={18} />
                </button>
                <button
                  onClick={onClose}
                  className="rounded-lg border border-slate-700 bg-slate-900/85 p-2 text-slate-300 hover:border-red-500 hover:text-red-400"
                  title="닫기"
                >
                  <X size={18} />
                </button>
              </div>
            )}

            {/* 결과 케이스 선택 (JSON 이 2개 이상일 때만) */}
            {!loading && !errorMessage && caseNames.length > 1 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex gap-1 bg-slate-900/85 backdrop-blur rounded-xl border border-slate-700 p-1.5 shadow-lg max-w-[50%] overflow-x-auto custom-scrollbar">
                {caseNames.map(name => (
                  <button
                    key={name}
                    onClick={() => setActiveCase(name)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                      activeCase === name
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-slate-700'
                    }`}
                    title={name}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}

            {/* 로딩 */}
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-brand-accent font-mono bg-slate-900/80 backdrop-blur-sm">
                <RefreshCw size={48} className="animate-spin mb-4" />
                BDF / 결과 JSON 로드 중...
              </div>
            )}

            {/* 에러 */}
            {!loading && errorMessage && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-slate-900 text-slate-300">
                <FileX size={48} className="mb-4 text-slate-500" />
                <p className="text-lg font-bold text-slate-100">{errorMessage}</p>
                <p className="text-sm text-slate-500 mt-2">해당 해석의 결과 파일이 서버에서 삭제되었거나 BDF 가 없습니다.</p>
              </div>
            )}

            {/* 본 뷰어 */}
            {!loading && !errorMessage && Object.keys(nodes).length > 0 && (
              <div className="w-full h-full">
                <AssessmentBdfViewer
                  nodes={nodes}
                  elements={elements}
                  resultData={activeCase ? resultsMap[activeCase] : null}
                  selectedElementId={selectedElementId}
                  onElementSelect={setSelectedElementId}
                  onViewStateChange={setViewerState}
                />
              </div>
            )}
            </div>

            {isInspectorOpen && (
              <aside className="relative z-30 flex w-[min(340px,42vw)] shrink-0 flex-col border-l border-slate-700 bg-slate-950 text-slate-200">
                <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
                  <Box size={17} className="text-blue-400" />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-bold text-white">Result Explorer</h4>
                    <p className="truncate text-[10px] text-slate-400">
                      {activeCase || 'Result'} · {viewerState.activeLoadCaseLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsInspectorOpen(false)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                    title="인스펙터 접기"
                  >
                    <PanelRightClose size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-950 hover:text-red-400"
                    title="닫기"
                  >
                    <X size={17} />
                  </button>
                </header>

                <div className="grid grid-cols-3 border-b border-slate-800">
                  <div className="border-r border-slate-800 px-3 py-3">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Elements</p>
                    <p className="mt-1 font-mono text-base font-black text-white">{allAssessmentRows.length}</p>
                  </div>
                  <div className="border-r border-slate-800 px-3 py-3">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Max U.F.</p>
                    <p className={`mt-1 font-mono text-base font-black ${maxAssessment >= 1 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {maxAssessment.toFixed(3)}
                    </p>
                  </div>
                  <div className="px-3 py-3">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Failed</p>
                    <p className={`mt-1 font-mono text-base font-black ${failedCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {failedCount}
                    </p>
                  </div>
                </div>

                {selectedRow && (
                  <div className={`m-3 rounded-xl border px-3 py-2.5 ${
                    selectedRow.assessment >= 1
                      ? 'border-red-800 bg-red-950/50'
                      : 'border-emerald-800 bg-emerald-950/40'
                  }`}>
                    <div className="flex items-center gap-2">
                      {selectedRow.assessment >= 1
                        ? <AlertTriangle size={15} className="text-red-400" />
                        : <CheckCircle2 size={15} className="text-emerald-400" />}
                      <p className="text-xs font-bold text-white">Element {selectedRow.element}</p>
                      <span className={`ml-auto text-[10px] font-black ${
                        selectedRow.assessment >= 1 ? 'text-red-400' : 'text-emerald-400'
                      }`}>
                        {selectedRow.result}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-300">
                      Usage factor <span className="font-black text-white">{selectedRow.assessment.toFixed(4)}</span>
                    </p>
                  </div>
                )}

                <div className="border-b border-slate-800 p-3">
                  <label className="relative block">
                    <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
                    <input
                      value={elementQuery}
                      onChange={(event) => setElementQuery(event.target.value)}
                      placeholder="Element ID 검색"
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-xs text-white outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    />
                  </label>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="sticky top-0 grid grid-cols-[1fr_84px_56px] border-b border-slate-800 bg-slate-950 px-3 py-2 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                    <span>Element</span>
                    <span className="text-right">Usage factor</span>
                    <span className="text-right">Result</span>
                  </div>
                  {assessmentRows.length > 0 ? assessmentRows.slice(0, 300).map(row => (
                    <button
                      key={row.element}
                      type="button"
                      onClick={() => setSelectedElementId(row.element)}
                      className={`grid w-full grid-cols-[1fr_84px_56px] border-b border-slate-900 px-3 py-2 text-left text-[11px] transition-colors hover:bg-slate-900 ${
                        String(selectedElementId) === String(row.element) ? 'bg-blue-950/60 ring-inset ring-1 ring-blue-700' : ''
                      }`}
                    >
                      <span className="font-mono font-bold text-slate-300">{row.element}</span>
                      <span className={`text-right font-mono font-bold ${row.assessment >= 1 ? 'text-red-400' : 'text-slate-300'}`}>
                        {row.assessment.toFixed(4)}
                      </span>
                      <span className={`text-right font-bold ${row.assessment >= 1 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {row.assessment >= 1 ? 'FAIL' : 'PASS'}
                      </span>
                    </button>
                  )) : (
                    <p className="px-4 py-10 text-center text-xs text-slate-500">표시할 요소 결과가 없습니다.</p>
                  )}
                </div>
              </aside>
            )}
          </Dialog.Panel>
        </div>
      </Dialog>
    </Transition>
  );
}
