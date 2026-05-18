/// <summary>
/// 과거 Truss Assessment 결과를 모델에 매핑하여 3D 뷰로 보여주는 모달.
/// BDF + JSON 결과 파일을 백엔드에서 받아 파싱 후 AssessmentBdfViewer 에 전달한다.
/// </summary>
import React, { Fragment, useEffect, useRef, useState } from 'react';
import { Dialog, Transition, TransitionChild } from '@headlessui/react';
import { X, RefreshCw, FileX, Box, Layers } from 'lucide-react';
import { downloadFileText, downloadFileBlob } from '../../api/analysis';
import AssessmentBdfViewer from '../analysis/AssessmentBdfViewer';

// 견고한 Nastran float 파서 — 쉼표 제거, D(Double) 포맷, 암묵 지수 지원
const parseNastranFloat = (str) => {
  if (!str || !str.trim()) return 0;
  let s = str.trim().toUpperCase().replace(/,/g, '').replace('D', 'E');
  if (s.includes('E')) {
    const v = parseFloat(s);
    return isNaN(v) ? 0 : v;
  }
  s = s.replace(/([0-9\.])([+-][0-9]+)$/, '$1E$2');
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
};

// 라인 기반 BDF 파서: GRID / GRID* / CROD·CBAR·CBEAM 지원
const parseBdfText = (bdfText) => {
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
        if (!isNaN(id)) {
          nodes[id] = [parseNastranFloat(p[3]), parseNastranFloat(p[4]), parseNastranFloat(p[5])];
        }
      } else if (line.startsWith('GRID*')) {
        const padded = line.padEnd(72, ' ');
        const id = parseInt(padded.substring(8, 24));
        const x = parseNastranFloat(padded.substring(40, 56));
        const y = parseNastranFloat(padded.substring(56, 72));
        let z = 0;
        const nextLine = lines[i + 1] ? lines[i + 1].trimEnd() : '';
        if (nextLine.startsWith('*')) {
          z = parseNastranFloat(nextLine.padEnd(24, ' ').substring(8, 24));
          i++;
        }
        if (!isNaN(id)) nodes[id] = [x, y, z];
      } else {
        const padded = line.padEnd(48, ' ');
        const id = parseInt(padded.substring(8, 16));
        const x = parseNastranFloat(padded.substring(24, 32));
        const y = parseNastranFloat(padded.substring(32, 40));
        const z = parseNastranFloat(padded.substring(40, 48));
        if (!isNaN(id)) nodes[id] = [x, y, z];
      }
      continue;
    }

    if (line.startsWith('CROD') || line.startsWith('CBAR') || line.startsWith('CBEAM')) {
      const padded = line.padEnd(40, ' ');
      const eid = parseInt(padded.substring(8, 16));
      const n1 = parseInt(padded.substring(24, 32));
      const n2 = parseInt(padded.substring(32, 40));
      if (!isNaN(n1) && !isNaN(n2)) elements.push([n1, n2, isNaN(eid) ? null : eid]);
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
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      setLoading(false);
      setErrorMessage('');
      setNodes({});
      setElements([]);
      setResultsMap({});
      setActiveCase(null);
      return;
    }
    if (!project?.result_info?.bdf) {
      setErrorMessage('BDF 결과 파일이 없습니다.');
      return;
    }
    if (project.files_available === false) {
      setErrorMessage('서버에서 파일이 삭제되었습니다.');
      return;
    }

    const reqId = ++reqIdRef.current;
    const load = async () => {
      setLoading(true);
      setErrorMessage('');
      try {
        // 1) BDF 다운로드 및 파싱
        const bdfRes = await downloadFileText(project.result_info.bdf);
        if (reqId !== reqIdRef.current) return;
        const { nodes: parsedNodes, elements: parsedElements } = parseBdfText(bdfRes.data || '');

        // 2) JSON 결과 파일들 다운로드 및 파싱
        const jsonEntries = Object.entries(project.result_info)
          .filter(([k, v]) => k.startsWith('JSON_') && typeof v === 'string')
          .map(([k, v]) => ({ key: k.replace(/^JSON_/i, ''), path: v }));
        const settled = await Promise.allSettled(jsonEntries.map(async (f) => {
          const res = await downloadFileBlob(f.path);
          const text = await res.data.text();
          return { key: f.key, data: JSON.parse(text) };
        }));
        if (reqId !== reqIdRef.current) return;
        const map = {};
        settled.forEach((r) => { if (r.status === 'fulfilled') map[r.value.key] = r.value.data; });

        if (Object.keys(parsedNodes).length === 0 || parsedElements.length === 0) {
          setErrorMessage('BDF 모델 파싱 결과가 비어 있습니다.');
          setLoading(false);
          return;
        }

        setNodes(parsedNodes);
        setElements(parsedElements);
        setResultsMap(map);
        setActiveCase(Object.keys(map)[0] || null);
        setLoading(false);
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        console.error('Result viewer load failed:', err);
        setErrorMessage(err?.response?.status === 404
          ? '결과 파일을 찾을 수 없습니다.'
          : '결과 파일을 불러오는 데 실패했습니다.');
        setLoading(false);
      }
    };
    load();
  }, [isOpen, project?.id]);

  const caseKeys = Object.keys(resultsMap);
  const activeResultData = activeCase ? resultsMap[activeCase] : null;
  const nodeCount = Object.keys(nodes).length;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150"  leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />
        </TransitionChild>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"  leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="relative w-full max-w-[1400px] h-[88vh] bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
              {/* 헤더 */}
              <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-emerald-700 to-emerald-600 shrink-0">
                <Dialog.Title className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                  <Layers size={16} />
                  과거 해석 결과 매핑 뷰 — {project?.project_name || 'Unnamed'}
                </Dialog.Title>
                <button
                  onClick={onClose}
                  className="text-white/80 hover:text-white hover:bg-white/10 rounded-lg p-1 transition-colors cursor-pointer"
                  aria-label="모달 닫기"
                >
                  <X size={18} />
                </button>
              </div>

              {/* 본문 */}
              <div className="flex-1 relative min-h-0">
                {/* 케이스 선택 탭 */}
                {!loading && !errorMessage && caseKeys.length > 1 && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex gap-1 bg-slate-900/85 backdrop-blur rounded-xl border border-slate-700 p-1.5 shadow-lg">
                    {caseKeys.map((k) => (
                      <button
                        key={k}
                        onClick={() => setActiveCase(k)}
                        className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${
                          activeCase === k ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
                        }`}
                        title={`결과 케이스: ${k}`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                )}

                {loading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 gap-3">
                    <RefreshCw size={28} className="animate-spin text-emerald-400" />
                    <p className="text-sm font-bold">결과 데이터를 불러오는 중...</p>
                    <p className="text-xs text-slate-500">BDF + JSON 파일을 다운로드하여 모델에 매핑합니다.</p>
                  </div>
                )}

                {!loading && errorMessage && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 gap-3">
                    <FileX size={32} className="text-slate-500" />
                    <p className="text-sm font-bold">{errorMessage}</p>
                  </div>
                )}

                {!loading && !errorMessage && nodeCount > 0 && (
                  <AssessmentBdfViewer
                    nodes={nodes}
                    elements={elements}
                    resultData={activeResultData}
                  />
                )}

                {!loading && !errorMessage && nodeCount === 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 gap-3">
                    <Box size={32} className="text-slate-500" />
                    <p className="text-sm font-bold">표시할 모델이 없습니다.</p>
                  </div>
                )}
              </div>
            </Dialog.Panel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
