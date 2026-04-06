import React, { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Upload, Activity, Layers, BarChart2, FileJson, Box } from 'lucide-react';
import GuideButton from '../../components/ui/GuideButton';
import { useFileParser, parseTsvText } from '../../hooks/useFileParser';


/**
 * @summary 보(Beam) 해석 모델 및 결과를 시각화하는 통합 대시보드 컴포넌트입니다.
 * @description JSON 모델 데이터 및 CSV 해석 결과 데이터를 업로드 받아 대시보드 형태로 표현합니다.
 */
const BeamAnalysisViewer = () => {
  // 상태 관리: 모델 데이터 (JSON) 및 해석 결과 (CSV)
  const [beamModel, setBeamModel] = useState(null);
  const [dispData, setDispData] = useState([]);
  const [elForceData, setElForceData] = useState([]);
  const [stressData, setStressData] = useState([]);

  const { readFile: readDispFile } = useFileParser(parseTsvText, setDispData,
    () => alert('변위 CSV 파싱에 실패했습니다. 파일 형식을 확인해주세요.'));
  const { readFile: readForceFile } = useFileParser(parseTsvText, setElForceData,
    () => alert('단면력 CSV 파싱에 실패했습니다. 파일 형식을 확인해주세요.'));
  const { readFile: readStressFile } = useFileParser(parseTsvText, setStressData,
    () => alert('응력 CSV 파싱에 실패했습니다. 파일 형식을 확인해주세요.'));

  const handleCsvUpload = (e, fileReader) => {
    if (e.target.files[0]) fileReader(e.target.files[0]);
  };

  const { readFile: readJsonFile } = useFileParser(
    (text) => JSON.parse(text),
    setBeamModel,
    () => alert('JSON 파싱 중 오류가 발생했습니다. 파일 형식을 확인해주세요.')
  );

  const handleJsonUpload = (e) => {
    if (e.target.files[0]) readJsonFile(e.target.files[0]);
  };

  /**
   * @summary ElementForce와 Stress 데이터의 X축을 위한 전처리기 (ElementId + Dist 조합)
   */
  const mapElementData = (data) => {
    return data.map((item) => ({
      ...item,
      ElementIndex: `E${item.ElementId}-${item.Dist}`,
    }));
  };

  const formattedElForceData = mapElementData(elForceData);
  const formattedStressData = mapElementData(stressData);

  /**
   * @summary Beam Model을 역변환하여 SVG로 렌더링하는 컴포넌트
   * @description JSON에 포함된 length, boundaries(Fix, Hinge), loads를 렌더링합니다.
   */
  const renderBeamSchematic = () => {
    if (!beamModel || !beamModel.model) return null;

    const { dimensions, boundaries, loads } = beamModel.model;
    const L = dimensions.length || 1000;
    
    // ViewBox 설정: 모델 길이에 비례하여 상하좌우 여백(Padding)을 동적으로 확보합니다.
    const paddingX = L * 0.15;
    const paddingY = L * 0.25; 
    const viewBox = `-${paddingX} -${paddingY} ${L + paddingX * 2} ${paddingY * 2}`;

    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h3 className="text-xl font-bold mb-4 text-slate-800 flex items-center gap-2">
          <Box className="text-indigo-600" />
          Beam Model Schematic (Imported)
        </h3>
        <div className="w-full overflow-x-auto bg-slate-50/50 rounded-lg border border-slate-200 p-4">
          <svg viewBox={viewBox} className="w-full h-80 min-w-[600px]">
            <defs>
              {/* 화살표 헤드 정의 */}
              <marker id="arrow-head" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto-start-reverse">
                <polygon points="0,0 10,5 0,10" fill="#f59e0b" />
              </marker>
              <marker id="dim-start" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
                <line x1="5" y1="0" x2="5" y2="10" stroke="#9ca3af" strokeWidth="2" />
              </marker>
              <marker id="dim-end" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
                <line x1="5" y1="0" x2="5" y2="10" stroke="#9ca3af" strokeWidth="2" />
              </marker>
            </defs>

            {/* Grid Line (기준선) */}
            <line x1="0" y1="0" x2={L} y2="0" stroke="#e5e7eb" strokeWidth="2" strokeDasharray="10 10" />
            
            {/* The Beam */}
            <line x1="0" y1="0" x2={L} y2="0" stroke="#1f2937" strokeWidth="16" strokeLinecap="round" />
            
            {/* 치수선 (Dimensions) */}
            <line x1="0" y1={L * 0.1} x2={L} y2={L * 0.1} stroke="#9ca3af" strokeWidth="2" markerStart="url(#dim-start)" markerEnd="url(#dim-end)" />
            <text x={L / 2} y={L * 0.1 + L * 0.05} textAnchor="middle" fill="#6b7280" fontSize={L * 0.035} fontWeight="bold">L = {L} mm</text>

            {/* 경계 조건 (Boundaries) */}
            {boundaries?.map((b, idx) => {
              const x = b.position;
              // 고정단 (Fix) 렌더링
              if (b.type === 'Fix') {
                return (
                  <g key={`bound-${idx}`} transform={`translate(${x}, 0)`}>
                    {/* 수직 벽면 */}
                    <line x1="0" y1={-(L * 0.08)} x2="0" y2={L * 0.08} stroke="#ef4444" strokeWidth="6" />
                    {/* 벽면 빗금 (Hatch marks) */}
                    {[-0.06, -0.02, 0.02, 0.06].map((offset, i) => {
                      const yPos = L * offset;
                      // Fix 위치가 x=0이면 빗금을 왼쪽에, 그 외의 경우 오른쪽에 그리도록 분기
                      const hatchDir = x === 0 ? -L * 0.03 : L * 0.03; 
                      return (
                        <line key={`hatch-${i}`} x1={hatchDir} y1={yPos - (L*0.02)} x2="0" y2={yPos} stroke="#ef4444" strokeWidth="2" />
                      );
                    })}
                    <text x={x === 0 ? -L * 0.06 : L * 0.06} y="0" dominantBaseline="middle" textAnchor="middle" fill="#ef4444" fontSize={L * 0.03} fontWeight="bold">Fix</text>
                  </g>
                );
              } 
              // 힌지/핀 (Hinge) 렌더링
              else if (b.type === 'Hinge') {
                const hSize = L * 0.05;
                return (
                  <g key={`bound-${idx}`} transform={`translate(${x}, 0)`}>
                    {/* 세모 핀 */}
                    <polygon points={`0,0 -${hSize/2},${hSize} ${hSize/2},${hSize}`} fill="none" stroke="#3b82f6" strokeWidth="4" />
                    {/* 바닥면 */}
                    <line x1={-(hSize)} y1={hSize} x2={hSize} y2={hSize} stroke="#3b82f6" strokeWidth="4" />
                    <circle cx="0" cy="0" r={L * 0.008} fill="white" stroke="#3b82f6" strokeWidth="3" />
                    <text x="0" y={hSize + L * 0.04} textAnchor="middle" fill="#3b82f6" fontSize={L * 0.03} fontWeight="bold">Hinge</text>
                  </g>
                );
              }
              return null;
            })}

            {/* 하중 (Loads) 렌더링 */}
            {loads?.map((load, idx) => {
              const x = load.position;
              const arrowLen = L * 0.12;
              return (
                <g key={`load-${idx}`} transform={`translate(${x}, ${-(arrowLen + L*0.02)})`}>
                  <line x1="0" y1="0" x2="0" y2={arrowLen} stroke="#f59e0b" strokeWidth="4" markerEnd="url(#arrow-head)" />
                  <text x="0" y={-L * 0.02} textAnchor="middle" fill="#f59e0b" fontSize={L * 0.035} fontWeight="bold">{load.magnitude} N</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <header className="flex items-center justify-between border-b pb-4">
          <div>
            <h1 className="text-2xl font-bold text-brand-blue tracking-tight flex items-center gap-2">
              <Activity className="text-blue-600" />
              Simple Beam Assessment Dashboard
            </h1>
            <p className="text-slate-500 mt-2">해석 모델(JSON) 및 결과(CSV) 파일을 업로드하여 시각화하세요.</p>
          </div>
          <GuideButton guideTitle="[대화형] Simple Beam Assessment — 보 해석" />
        </header>

        {/* File Upload Section */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          
          {/* JSON Model Upload */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-indigo-100 flex flex-col gap-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileJson className="text-indigo-500" size={20} />
              Model (beam.json)
            </h2>
            <label className="flex items-center justify-center w-full h-24 border-2 border-dashed border-indigo-300 rounded-lg cursor-pointer hover:bg-indigo-50 transition-colors">
              <div className="flex flex-col items-center">
                <Upload size={24} className="text-indigo-400 mb-1" />
                <span className="text-sm text-indigo-500 font-medium">Upload beam.json</span>
              </div>
              <input type="file" accept=".json" className="hidden" onChange={handleJsonUpload} />
            </label>
            {beamModel && <p className="text-sm text-indigo-600 font-medium">✅ Model loaded</p>}
          </div>

          {/* Displacement Upload */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col gap-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Layers className="text-blue-500" size={20} />
              Disp (disp.csv)
            </h2>
            <label className="flex items-center justify-center w-full h-24 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
              <div className="flex flex-col items-center">
                <Upload size={24} className="text-slate-400 mb-1" />
                <span className="text-sm text-slate-500">Upload disp.csv</span>
              </div>
              <input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => handleCsvUpload(e, readDispFile)} />
            </label>
            {dispData.length > 0 && <p className="text-sm text-green-600 font-medium">✅ {dispData.length} records</p>}
          </div>

          {/* Element Force Upload */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col gap-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Activity className="text-red-500" size={20} />
              Force (elforce.csv)
            </h2>
            <label className="flex items-center justify-center w-full h-24 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
              <div className="flex flex-col items-center">
                <Upload size={24} className="text-slate-400 mb-1" />
                <span className="text-sm text-slate-500">Upload elforce.csv</span>
              </div>
              <input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => handleCsvUpload(e, readForceFile)} />
            </label>
            {elForceData.length > 0 && <p className="text-sm text-green-600 font-medium">✅ {elForceData.length} records</p>}
          </div>

          {/* Stress Upload */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col gap-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <BarChart2 className="text-purple-500" size={20} />
              Stress (stress.csv)
            </h2>
            <label className="flex items-center justify-center w-full h-24 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
              <div className="flex flex-col items-center">
                <Upload size={24} className="text-slate-400 mb-1" />
                <span className="text-sm text-slate-500">Upload stress.csv</span>
              </div>
              <input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => handleCsvUpload(e, readStressFile)} />
            </label>
            {stressData.length > 0 && <p className="text-sm text-green-600 font-medium">✅ {stressData.length} records</p>}
          </div>
        </section>

        {/* Visualization Section */}
        <section className="space-y-8">
          
          {/* Schematic Rendering */}
          {renderBeamSchematic()}

          {/* 1. Displacement Chart */}
          {dispData.length > 0 && (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
              <h3 className="text-xl font-bold mb-4 text-slate-800">Vertical Displacement (DispZ)</h3>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dispData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="X[mm]" label={{ value: 'X Position [mm]', position: 'insideBottomRight', offset: -10 }} />
                    <YAxis label={{ value: 'DispZ [mm]', angle: -90, position: 'insideLeft' }} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Legend verticalAlign="top" height={36}/>
                    <Line type="monotone" dataKey="DispZ[mm]" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 8 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* 2. Bending Moment & Shear Force Charts */}
          {formattedElForceData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                <h3 className="text-xl font-bold mb-4 text-slate-800">Bending Moment</h3>
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={formattedElForceData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="ElementIndex" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="stepAfter" dataKey="BendingMoment1" stroke="#ef4444" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                <h3 className="text-xl font-bold mb-4 text-slate-800">Shear Force</h3>
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={formattedElForceData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="ElementIndex" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="stepAfter" dataKey="ShearForce1" stroke="#f59e0b" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* 3. Stress Chart */}
          {formattedStressData.length > 0 && (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
              <h3 className="text-xl font-bold mb-4 text-slate-800">Element Stress (Max / Min)</h3>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={formattedStressData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="ElementIndex" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="S-MAX[MPa]" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="S-MIN[MPa]" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Empty State Fallback */}
          {!beamModel && dispData.length === 0 && elForceData.length === 0 && stressData.length === 0 && (
            <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-slate-100">
              <BarChart2 className="mx-auto text-slate-300 mb-4" size={48} />
              <p className="text-slate-500 text-lg">해석 데이터(CSV) 및 모델(JSON) 파일을 업로드하시면 대시보드가 생성됩니다.</p>
            </div>
          )}
          
        </section>
      </div>
    </div>
  );
};

export default BeamAnalysisViewer;