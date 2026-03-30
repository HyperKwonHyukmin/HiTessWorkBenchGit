/**
 * @fileoverview Recharts 라이브러리를 활용한 변위, 단면력, 응력 차트 컴포넌트
 */
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, ReferenceLine } from 'recharts';

const engFormat = (val) => {
  if (val === undefined || val === null) return '';
  if (val === 0) return '0';
  const abs = Math.abs(val);
  if (abs >= 10000 || abs < 0.001) return val.toExponential(2);
  return Number.isInteger(val) ? val.toString() : val.toFixed(2);
};

export default function EngineeringCharts({ dispData, elForceData, stressData, isCapturing }) {
  return (
    <div className={`bg-slate-900 ${isCapturing ? 'flex flex-col gap-8 w-full h-max p-0 bg-transparent overflow-visible' : 'h-[55%] overflow-y-auto custom-scrollbar p-6 space-y-6'}`}>
      {dispData.length > 0 && (
        <div className={`bg-slate-950 p-5 rounded-xl border border-slate-800 shrink-0 ${isCapturing ? 'h-[400px]' : 'h-64'}`}>
          <h3 className="text-sm font-bold text-white mb-4 tracking-wider">DEFLECTION (DispZ)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dispData} margin={{ top: 10, right: 20, left: 30, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="X[mm]" stroke="#94a3b8" tick={{fontSize: 11}} type="number" domain={['dataMin', 'dataMax']} />
              <YAxis stroke="#94a3b8" tick={{fontSize: 11}} tickFormatter={engFormat} domain={['auto','auto']} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px' }} itemStyle={{ color: '#f8fafc' }} formatter={(val) => engFormat(val)} />
              <ReferenceLine y={0} stroke="#64748b" strokeWidth={1} />
              <Line isAnimationActive={!isCapturing} type="monotone" dataKey="DispZ[mm]" stroke="#38bdf8" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {elForceData.length > 0 && (
        <div className={isCapturing ? "flex flex-col gap-8 w-full" : "grid grid-cols-2 gap-6 h-64 shrink-0"}>
          <div className={`bg-slate-950 p-5 rounded-xl border border-slate-800 ${isCapturing ? 'h-[400px]' : ''}`}>
            <h3 className="text-sm font-bold text-white mb-4 tracking-wider">BENDING MOMENT DIAGRAM (BMD)</h3>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={elForceData} margin={{ top: 10, right: 10, left: 30, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="X[mm]" stroke="#94a3b8" tick={{fontSize: 11}} type="number" domain={['dataMin', 'dataMax']} />
                <YAxis stroke="#94a3b8" tick={{fontSize: 11}} tickFormatter={engFormat} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px' }} itemStyle={{ color: '#f8fafc' }} formatter={(val) => engFormat(val)} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
                <Area isAnimationActive={!isCapturing} type="linear" dataKey="BendingMoment1" stroke="#f87171" fill="#7f1d1d" fillOpacity={0.6} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className={`bg-slate-950 p-5 rounded-xl border border-slate-800 ${isCapturing ? 'h-[400px]' : ''}`}>
            <h3 className="text-sm font-bold text-white mb-4 tracking-wider">SHEAR FORCE DIAGRAM (SFD)</h3>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={elForceData} margin={{ top: 10, right: 10, left: 30, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="X[mm]" stroke="#94a3b8" tick={{fontSize: 11}} type="number" domain={['dataMin', 'dataMax']} />
                <YAxis stroke="#94a3b8" tick={{fontSize: 11}} tickFormatter={engFormat} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px' }} itemStyle={{ color: '#f8fafc' }} formatter={(val) => engFormat(val)} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
                <Area isAnimationActive={!isCapturing} type="linear" dataKey="ShearForce1" stroke="#fbbf24" fill="#78350f" fillOpacity={0.6} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {stressData.length > 0 && (
        <div className={`bg-slate-950 p-5 rounded-xl border border-slate-800 shrink-0 ${isCapturing ? 'h-[400px]' : 'h-64'}`}>
          <h3 className="text-sm font-bold text-white mb-4 tracking-wider">STRESS ENVELOPE (Max/Min)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stressData} margin={{ top: 10, right: 20, left: 30, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="X[mm]" stroke="#94a3b8" tick={{fontSize: 11}} type="number" domain={['dataMin', 'dataMax']} />
              <YAxis stroke="#94a3b8" tick={{fontSize: 11}} tickFormatter={engFormat} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px' }} itemStyle={{ color: '#f8fafc' }} formatter={(val) => engFormat(val)} />
              <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }} />
              <ReferenceLine y={0} stroke="#64748b" strokeWidth={1} />
              <Line isAnimationActive={!isCapturing} type="linear" dataKey="S-MAX[MPa]" stroke="#a78bfa" strokeWidth={2} dot={false} />
              <Line isAnimationActive={!isCapturing} type="linear" dataKey="S-MIN[MPa]" stroke="#34d399" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}