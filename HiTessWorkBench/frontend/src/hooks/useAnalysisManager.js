/**
 * @fileoverview 결과 데이터(변위, 단면력, 응력) 상태 관리 및 서버 통신(API/JSON) 로직
 */
import { useState, useEffect, useRef } from 'react';
import { useDashboard } from '../contexts/DashboardContext';
import { useAuth } from '../contexts/AuthContext';
import { requestBeamAnalysis, downloadFileText } from '../api/analysis';
import { loadToNewton, withYzPolar } from './useBeamModeling';

export function useAnalysisManager(modelingHook, showToast, setActiveTab) {
  const { employeeId: authEmployeeId } = useAuth();
  const PAGE_KEY = 'Simple Beam Assessment';
  const dashboardCtx = useDashboard();
  const savedPageState = dashboardCtx?.analysisPageStates?.[PAGE_KEY] || {};
  const savedResults = savedPageState.results || {};
  const [dispData, setDispData] = useState(savedResults.dispData ?? []);
  const [elForceData, setElForceData] = useState(savedResults.elForceData ?? []);
  const [stressData, setStressData] = useState(savedResults.stressData ?? []);
  const [summaryData, setSummaryData] = useState(savedResults.summaryData ?? null);

  const { globalJob, startGlobalJob, clearGlobalJob } = dashboardCtx;
  const restoredJobRef = useRef(null);
  
  const hasCharts = dispData.length > 0 || elForceData.length > 0 || stressData.length > 0;
  const isAnalyzing = globalJob?.menu === 'Simple Beam Assessment' && globalJob?.status === 'Running';
  const isReadOnly = hasCharts || isAnalyzing;

  useEffect(() => {
    dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, {
      results: { dispData, elForceData, stressData, summaryData },
    });
  }, [dispData, elForceData, stressData, summaryData]);

  const mapElementDataWithX = (arr, totalLength) => {
    const uniqueIds = [...new Set(arr.map(a => a.elementId))].sort((a, b) => a - b);
    const numElements = uniqueIds.length;
    const elementLength = numElements > 0 ? totalLength / numElements : 0;
    return arr.map(a => {
      const idx = uniqueIds.indexOf(a.elementId);
      const xPos = (idx + a.dist) * elementLength;
      return { ...a, 'X[mm]': parseFloat(xPos.toFixed(3)) };
    }).sort((a, b) => a['X[mm]'] - b['X[mm]']); 
  };

  const processResultJson = (json) => {
    const modelLength = Number(json.model?.dimensions?.length) || 1000;
    if (json.model && json.model.dimensions) {
      modelingHook.overrideModelData(
        json.model.beamType || 'I',
        {
          length: json.model.dimensions.length || 1000, dim1: json.model.dimensions.dim1 || 100,
          dim2: json.model.dimensions.dim2 || 200, dim3: json.model.dimensions.dim3 || 0, dim4: json.model.dimensions.dim4 || 0,
        },
        json.model.boundaries?.map(b => ({ pos: b.position, type: b.type, dof: b.dof || '' })),
        json.model.loads?.map(l => withYzPolar({ pos: l.position, fx: l.fx || 0, fy: l.fy || 0, fz: l.fz !== undefined ? l.fz : (l.magnitude ? -l.magnitude : 0), unit: l.unit || 'N' }))
      );
    }

    if (json.result) {
      if (json.result.nodeResults) {
        setDispData(json.result.nodeResults.map(n => ({ 'X[mm]': n.x, 'DispZ[mm]': n.dispZ })).sort((a, b) => a['X[mm]'] - b['X[mm]']));
      }
      if (json.result.forceResults) {
        setElForceData(mapElementDataWithX(json.result.forceResults, modelLength).map(f => ({
          'X[mm]': f['X[mm]'], BendingMoment1: f.bendingMoment1, ShearForce1: f.shearForce1
        })));
      }
      if (json.result.elementResults) {
        setStressData(mapElementDataWithX(json.result.elementResults, modelLength).map(e => ({
          'X[mm]': e['X[mm]'], 'S-MAX[MPa]': e.sMax || e.maxStress || 0, 'S-MIN[MPa]': e.sMin || (e.maxStress ? -e.maxStress : 0)
        })));
      }
      if (json.result.summary) setSummaryData(json.result.summary);
      setActiveTab('results');
    }
  };

  const handleRunAnalysis = async () => {
    if (modelingHook.validationErrors.length > 0) return;
    try {
      const exportData = {
        metadata: { module: "Simple Beam Assessment", timestamp: new Date().toISOString(), version: "1.0.0" },
        model: {
          beamType: modelingHook.beamType,
          dimensions: { length: Number(modelingHook.params.length), dim1: Number(modelingHook.params.dim1), dim2: Number(modelingHook.params.dim2), dim3: Number(modelingHook.params.dim3), dim4: Number(modelingHook.params.dim4) },
          boundaries: modelingHook.boundaries.map(b => ({ position: Number(b.pos), type: b.type, ...(b.type === 'Custom' ? { dof: b.dof } : {}) })),
          // 해석 입력은 항상 N 으로 정규화 (사용자 입력이 ton 이어도 fx/fy/fz 환산해서 전송)
          loads: modelingHook.loads.map(l => {
            const n = loadToNewton(l);
            return { position: Number(l.pos), fx: n.fx, fy: n.fy, fz: n.fz };
          })
        }
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const employeeId = authEmployeeId || 'guest';
      const formData = new FormData();
      formData.append('beam_file', blob, 'beam.json');
      formData.append('employee_id', employeeId);
      formData.append('source', 'Workbench');

      const requestRes = await requestBeamAnalysis(formData);
      startGlobalJob(requestRes.data.job_id, 'Simple Beam Assessment');
    } catch (err) { 
      showToast(`해석 요청 중 오류가 발생했습니다.\n${err.message}`, "error");
    }
  };

  const restoreCompletedJob = async (jobData) => {
    if (!jobData?.jobId || restoredJobRef.current === jobData.jobId || hasCharts) return;
    if (!jobData.result_path) return;
    restoredJobRef.current = jobData.jobId;
    try {
      const downloadRes = await downloadFileText(jobData.result_path);
      const json = JSON.parse(downloadRes.data);
      processResultJson(json);
      showToast("서버 해석이 성공적으로 완료되었습니다.", "success");
    } catch {
      showToast("결과 파일을 불러오는 중 오류가 발생했습니다.", "error");
    }
  };

  useEffect(() => {
    if (globalJob && globalJob.menu === PAGE_KEY) {
      if (globalJob.status === 'Success' && !hasCharts) {
        restoreCompletedJob(globalJob);
      } else if (globalJob.status === 'Failed' && !hasCharts) {
        showToast(`해석이 실패했습니다.\n${globalJob.engine_log}`, "error");
        clearGlobalJob();
      }
    }
  }, [globalJob, hasCharts]);

  useEffect(() => {
    const savedJob = savedPageState.job;
    if (savedJob?.status === 'Success' && savedJob.completeData && !savedJob.resultRestored) {
      restoreCompletedJob(savedJob.completeData);
      dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, {
        job: { ...savedJob, resultRestored: true },
      });
    }
  }, [savedPageState.job?.jobId, savedPageState.job?.status, savedPageState.job?.resultRestored, hasCharts]);

  const resetResults = () => {
    setDispData([]); setElForceData([]); setStressData([]); setSummaryData(null);
    clearGlobalJob();
    dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, {
      results: { dispData: [], elForceData: [], stressData: [], summaryData: null },
    });
  };

  return {
    dispData, elForceData, stressData, summaryData, hasCharts, isAnalyzing, isReadOnly, globalJob,
    processResultJson, handleRunAnalysis, resetResults
  };
}
