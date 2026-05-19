// HP-SCR 배관해석 과거 결과 3D 시각화 모달.
// HpScrAssessment 페이지와 동일하게 JSON_ModelInfo + BDF 보강을 거쳐
// BdfModelViewer 의 pipeMode 뷰어를 띄운다.
import React, { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X, RefreshCw, FileX, Pipette } from 'lucide-react';
import BdfModelViewer from '../analysis/BdfModelViewer';
import { downloadFileText } from '../../api/analysis';
import { buildHpScrModelData } from '../../utils/bdfPipeParsers';

export default function HpScrViewerModal({ isOpen, project, onClose }) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [modelData, setModelData] = useState(null);

  useEffect(() => {
    if (!isOpen) {
      setLoading(false);
      setErrorMessage('');
      setModelData(null);
      return;
    }
    const result_info = project?.result_info || {};
    if (!result_info.JSON_ModelInfo) {
      setErrorMessage('모델 JSON 파일 없음 — 이 해석은 3D 시각화를 사용할 수 없습니다.');
      return;
    }
    if (project?.files_available === false) {
      setErrorMessage('파일 없음');
      return;
    }

    let aborted = false;
    const load = async () => {
      setLoading(true);
      setErrorMessage('');
      try {
        const jsonRes = await downloadFileText(result_info.JSON_ModelInfo);
        let bdfText = '';
        if (result_info.bdf) {
          try {
            const bdfRes = await downloadFileText(result_info.bdf);
            bdfText = bdfRes.data || '';
          } catch {
            // BDF 보강 실패는 치명적이지 않다 — 모델 기본 형상만 렌더링.
          }
        }
        if (aborted) return;
        const built = buildHpScrModelData(jsonRes.data, bdfText);
        if (!built) {
          setErrorMessage('모델 JSON 형식이 올바르지 않습니다.');
          return;
        }
        setModelData(built);
      } catch (err) {
        if (aborted) return;
        if (err?.response?.status === 404) {
          setErrorMessage('파일 없음');
          return;
        }
        setErrorMessage('3D 모델을 불러오지 못했습니다.');
      } finally {
        if (!aborted) setLoading(false);
      }
    };
    load();
    return () => { aborted = true; };
  }, [isOpen, project]);

  const mode = project?.result_info?.analysis_mode || '';
  const titleSuffix = mode ? ` — ${mode}` : '';

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm" />
        <div className="fixed inset-0 flex items-center justify-center p-6">
          <Dialog.Panel className="w-full h-full bg-slate-900 rounded-2xl flex flex-col border border-slate-700 overflow-hidden shadow-2xl relative">

            <div className="absolute top-4 left-6 z-10 pointer-events-none flex flex-col gap-1">
              <h3 className="text-brand-accent font-bold tracking-widest text-xl drop-shadow-md flex items-center gap-2">
                <Pipette size={22} className="text-sky-300" />
                HP-SCR 배관해석 3D Viewer{titleSuffix}
              </h3>
              {project?.project_name && (
                <p className="text-slate-300 text-xs font-mono bg-black/50 px-2 py-1 rounded w-fit mt-1">
                  {project.project_name}
                </p>
              )}
            </div>

            <button
              onClick={onClose}
              className="absolute top-4 right-6 z-10 text-white hover:text-red-400 cursor-pointer bg-black/50 p-2 rounded-full transition-colors"
            >
              <X size={24} />
            </button>

            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-brand-accent font-mono bg-slate-900/80 backdrop-blur-sm">
                <RefreshCw size={48} className="animate-spin mb-4" />
                배관 모델 로드 중...
              </div>
            )}

            {!loading && errorMessage && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-slate-900 text-slate-300">
                <FileX size={48} className="mb-4 text-slate-500" />
                <p className="text-lg font-bold text-slate-100">{errorMessage}</p>
                <p className="text-sm text-slate-500 mt-2">해당 해석의 작업 폴더 또는 모델 JSON 이 서버에 없습니다.</p>
              </div>
            )}

            {!loading && !errorMessage && modelData && (
              <div className="w-full h-full">
                <BdfModelViewer modelData={modelData} pipeMode />
              </div>
            )}

          </Dialog.Panel>
        </div>
      </Dialog>
    </Transition>
  );
}
