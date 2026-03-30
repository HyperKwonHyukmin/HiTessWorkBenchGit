/**
 * @fileoverview 결과 데이터(변위, 단면력, 응력) 상태 관리 및 서버 통신(API/JSON) 로직
 */
import { useState, useEffect } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';

export function useAnalysisManager(modelingHook, showToast, setActiveTab) {
  const [dispData, setDispData] = useState([]);
  const [elForceData, setElForceData] = useState([]);
  const [stressData, setStressData] = useState([]);
  const [summaryData, setSummaryData] = useState(null);

  const { globalJob, startGlobalJob, clearGlobalJob } = useDashboard();
  
  const hasCharts = dispData.length > 0 || elForceData.length > 0 || stressData.length > 0;
  const isAnalyzing = globalJob?.menu === 'Simple Beam Assessment' && globalJob?.status === 'Running';
  const isReadOnly = hasCharts || isAnalyzing;

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
        json.model.loads?.map(l => ({ pos: l.position, fx: l.fx || 0, fy: l.fy || 0, fz: l.fz !== undefined ? l.fz : (l.magnitude ? -l.magnitude : 0) }))
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
          loads: modelingHook.loads.map(l => ({ position: Number(l.pos), fx: Number(l.fx), fy: Number(l.fy), fz: Number(l.fz) }))
        }
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const formData = new FormData();
      formData.append('beam_file', blob, 'beam.json');
      formData.append('employee_id', "A476854");
      formData.append('source', 'Workbench');

      const res = await fetch('http://localhost:8000/api/analysis/beam/request', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`서버 요청 실패 (${res.status})`);
      const resData = await res.json();
      startGlobalJob(resData.job_id, 'Simple Beam Assessment');
    } catch (err) { 
      showToast(`해석 요청 중 오류가 발생했습니다.\n${err.message}`, "error");
    }
  };

  useEffect(() => {
    if (globalJob && globalJob.menu === 'Simple Beam Assessment') {
      if (globalJob.status === 'Success' && !hasCharts) {
        const fetchResult = async () => {
          try {
            const res = await fetch(`http://localhost:8000/api/download?filepath=${encodeURIComponent(globalJob.result_path)}`);
            const json = await res.json();
            processResultJson(json);
            showToast("서버 해석이 성공적으로 완료되었습니다.", "success");
          } catch (e) {
            showToast("결과 파일을 불러오는 중 오류가 발생했습니다.", "error");
          }
        };
        fetchResult();
      } else if (globalJob.status === 'Failed' && !hasCharts) {
        showToast(`해석이 실패했습니다.\n${globalJob.engine_log}`, "error");
        clearGlobalJob();
      }
    }
  }, [globalJob, hasCharts]);

  const resetResults = () => {
    setDispData([]); setElForceData([]); setStressData([]); setSummaryData(null);
    clearGlobalJob();
  };

  return {
    dispData, elForceData, stressData, summaryData, hasCharts, isAnalyzing, isReadOnly, globalJob,
    processResultJson, handleRunAnalysis, resetResults
  };
}