/**
 * @fileoverview 단면 형상, 치수, 하중, 경계조건 등 모델링 상태를 관리하고 유효성을 검증하는 Custom Hook
 */
import { useState, useEffect } from 'react';

export function useBeamModeling() {
  const [beamType, setBeamType] = useState('I');
  const [params, setParams] = useState({ length: 1000, dim1: 100, dim2: 200, dim3: 10, dim4: 8 });
  const [loads, setLoads] = useState([{ pos: 1000, fx: 0, fy: 0, fz: -5000 }]);
  const [boundaries, setBoundaries] = useState([{ pos: 0, type: 'Fix', dof: '' }]);
  const [validationErrors, setValidationErrors] = useState([]);

  // 입력값 유효성 검사
  useEffect(() => {
    const errors = [];
    const { length, dim1, dim2, dim3, dim4 } = {
      length: Number(params.length) || 0,
      dim1: Number(params.dim1) || 0,
      dim2: Number(params.dim2) || 0,
      dim3: Number(params.dim3) || 0,
      dim4: Number(params.dim4) || 0
    };

    if (length <= 0) errors.push("부재 길이는 0보다 커야 합니다.");
    if (dim1 <= 0 || dim2 <= 0) errors.push("기본 치수(W, H, D 등)는 0보다 커야 합니다.");
    if (beamType === 'TUBE' && dim2 >= dim1 / 2) errors.push(`TUBE 두께는 반경보다 작아야 합니다.`);
    if (['I', 'CHAN'].includes(beamType)) {
      if (dim3 >= dim2 / 2) errors.push(`Flange 두께는 전체 높이 절반보다 작아야 합니다.`);
      if (dim4 >= dim1) errors.push(`Web 두께는 전체 폭보다 작아야 합니다.`);
    }
    boundaries.forEach((bc, i) => { if ((Number(bc.pos) || 0) < 0 || (Number(bc.pos) || 0) > length) errors.push(`경계조건 #${i + 1} 위치가 부재 길이를 벗어납니다.`); });
    loads.forEach((load, i) => { if ((Number(load.pos) || 0) < 0 || (Number(load.pos) || 0) > length) errors.push(`하중 #${i + 1} 위치가 부재 길이를 벗어납니다.`); });
    
    setValidationErrors(errors);
  }, [params, beamType, loads, boundaries]);

  const handleBeamTypeChange = (type) => {
    setBeamType(type);
    const newParams = { ...params };
    switch (type) {
      case 'BAR': newParams.dim1 = 50; newParams.dim2 = 100; break;
      case 'I': newParams.dim1 = 100; newParams.dim2 = 200; newParams.dim3 = 10; newParams.dim4 = 8; break;
      case 'H': newParams.dim1 = 200; newParams.dim2 = 200; newParams.dim3 = 15; newParams.dim4 = 15; break;
      case 'CHAN': newParams.dim1 = 100; newParams.dim2 = 200; newParams.dim3 = 15; newParams.dim4 = 10; break;
      case 'L': case 'T': newParams.dim1 = 100; newParams.dim2 = 100; newParams.dim3 = 10; newParams.dim4 = 10; break;
      case 'ROD': newParams.dim1 = 100; break;
      case 'TUBE': newParams.dim1 = 100; newParams.dim2 = 20; break;
      default: break;
    }
    setParams(newParams);
  };

  const updateBc = (idx, field, value) => {
    const newBc = [...boundaries];
    newBc[idx][field] = value;
    setBoundaries(newBc);
  };

  const updateLoad = (idx, field, value) => {
    const newLoads = [...loads];
    newLoads[idx][field] = value;
    setLoads(newLoads);
  };

  const overrideModelData = (type, dimensions, newBoundaries, newLoads) => {
    setBeamType(type);
    setParams(dimensions);
    if (newBoundaries) setBoundaries(newBoundaries);
    if (newLoads) setLoads(newLoads);
  };

  const resetModeling = () => {
    setBeamType('I');
    setParams({ length: 1000, dim1: 100, dim2: 200, dim3: 10, dim4: 8 });
    setLoads([{ pos: 500, fx: 0, fy: 0, fz: -5000 }]);
    setBoundaries([{ pos: 0, type: 'Fix', dof: '' }, { pos: 1000, type: 'Hinge', dof: '' }]);
  };

  return {
    beamType, params, loads, boundaries, validationErrors,
    setParams, setLoads, setBoundaries,
    handleBeamTypeChange, updateBc, updateLoad, overrideModelData, resetModeling
  };
}