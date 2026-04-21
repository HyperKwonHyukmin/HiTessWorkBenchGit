import React, { useState, useEffect, Fragment } from 'react';
import { Dialog, Transition, TransitionChild } from '@headlessui/react';
import { X, Search, FolderOpen, AlertCircle } from 'lucide-react';
import { getAnalysisHistory } from '../../api/analysis';
import { ANALYSIS_DATA } from '../../contexts/DashboardContext';

/**
 * 이전 분석 결과 탐색 모달.
 * targetApp으로 전달 가능한 소스 앱의 완료 기록을 조회하여 선택할 수 있게 한다.
 * 새로운 앱 간 연결 추가 시 ANALYSIS_DATA만 수정하면 된다.
 *
 * @param {boolean}  isOpen
 * @param {function} onClose
 * @param {string}   targetApp  - 전달받을 앱 title (ANALYSIS_DATA 기준)
 * @param {function} onSelect   - ({ analysisId, filePath, fileKey, projectName, sourceApp, targetApp }) => void
 */
export default function TransferBrowseModal({ isOpen, onClose, targetApp, onSelect }) {
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // targetApp을 받을 수 있는 소스 앱 목록
  const sourceApps = ANALYSIS_DATA
    .filter(a => a.transferOutputs?.some(o => o.targetApp === targetApp))
    .map(a => a.title);

  const getAvailableOutput = (programName, resultInfo) => {
    const app = ANALYSIS_DATA.find(a => a.title === programName);
    const outputs = app?.transferOutputs?.filter(o => o.targetApp === targetApp) ?? [];
    return outputs.find(o => resultInfo?.[o.key]) ?? null;
  };

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    setSearchQuery('');
    const userStr = localStorage.getItem('user');
    const employeeId = userStr ? JSON.parse(userStr).employee_id : 'guest';

    getAnalysisHistory(employeeId, 0, 200)
      .then(res => {
        const items = res.data.items ?? [];
        // 소스 앱의 완료 기록 전체를 표시 (f06 없는 것도 표시하되 비활성)
        const filtered = items.filter(item =>
          sourceApps.includes(item.program_name) &&
          item.status === 'Success'
        );
        setRecords(filtered);
      })
      .catch(() => setRecords([]))
      .finally(() => setIsLoading(false));
  }, [isOpen]);

  const handleRowClick = (record) => {
    const output = getAvailableOutput(record.program_name, record.result_info);
    if (!output) return;
    onSelect({
      analysisId: record.id,
      filePath: record.result_info[output.key],
      fileKey: output.key,
      projectName: record.project_name,
      sourceApp: record.program_name,
      targetApp,
    });
    onClose();
  };

  const filteredRecords = records.filter(r =>
    !searchQuery ||
    (r.project_name ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(r.id).includes(searchQuery)
  );

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[99999]" onClose={onClose}>
        {/* 배경 오버레이 */}
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />
        </TransitionChild>

        {/* 모달 패널 */}
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95 translate-y-2"
            enterTo="opacity-100 scale-100 translate-y-0"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100 translate-y-0"
            leaveTo="opacity-0 scale-95 translate-y-2"
          >
            <Dialog.Panel className="relative w-full max-w-[580px] max-h-[72vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              {/* 헤더 */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center">
                    <FolderOpen size={15} className="text-indigo-600" />
                  </div>
                  <div>
                    <Dialog.Title className="text-sm font-bold text-slate-800">
                      이전 분석 결과 불러오기
                    </Dialog.Title>
                    <p className="text-[11px] text-slate-400 mt-0.5">{sourceApps.join(', ')} 완료 기록에서 선택</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 검색 */}
              <div className="px-5 py-3 border-b border-slate-100 shrink-0">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="프로젝트명 또는 ID 검색..."
                    className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    autoFocus
                  />
                </div>
              </div>

              {/* 목록 */}
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center h-40 text-slate-400 text-xs">
                    로드 중...
                  </div>
                ) : filteredRecords.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-400">
                    <FolderOpen size={28} className="opacity-30" />
                    <p className="text-xs">
                      {records.length === 0
                        ? '완료된 분석 기록이 없습니다.'
                        : '검색 결과가 없습니다.'}
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 z-10">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-semibold text-slate-500 w-16">ID</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-slate-500">프로젝트명</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-slate-500 w-28">앱</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-slate-500 w-24">날짜</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecords.map(record => {
                        const output = getAvailableOutput(record.program_name, record.result_info);
                        const isAvailable = !!output;
                        return (
                          <tr
                            key={record.id}
                            onClick={() => isAvailable && handleRowClick(record)}
                            className={`border-b border-slate-50 transition-colors ${
                              isAvailable
                                ? 'hover:bg-indigo-50 cursor-pointer group'
                                : 'opacity-50 cursor-default'
                            }`}
                          >
                            <td className="px-4 py-3 font-mono text-slate-400 group-hover:text-indigo-500">
                              #{record.id}
                            </td>
                            <td className="px-4 py-3 text-slate-700 font-medium max-w-[200px]">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate">{record.project_name ?? '—'}</span>
                                {!isAvailable && (
                                  <span title="Nastran 해석 결과(F06)가 없습니다">
                                    <AlertCircle size={11} className="text-slate-300 shrink-0" />
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-500">{record.program_name}</td>
                            <td className="px-4 py-3 text-slate-400">
                              {record.created_at
                                ? new Date(record.created_at).toLocaleDateString('ko-KR')
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* 푸터 */}
              {!isLoading && filteredRecords.length > 0 && (
                <div className="px-5 py-2.5 border-t border-slate-100 shrink-0 bg-slate-50 flex items-center gap-2">
                  <p className="text-[11px] text-slate-400">{filteredRecords.length}개 기록 표시</p>
                  <span className="text-[11px] text-slate-300">·</span>
                  <p className="text-[11px] text-slate-400">
                    <AlertCircle size={10} className="inline mr-0.5 text-slate-300" />
                    아이콘 항목은 Nastran F06 파일 없음 (재실행 필요)
                  </p>
                </div>
              )}
            </Dialog.Panel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
