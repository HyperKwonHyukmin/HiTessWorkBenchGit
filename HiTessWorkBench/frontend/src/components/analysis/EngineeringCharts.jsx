/**
 * @fileoverview Recharts 라이브러리를 활용한 변위, 단면력, 응력 차트 컴포넌트
 * captureMode: null=일반, 'full'=전체 캡쳐, 'displacement'=변위만, 'stress'=응력만
 */
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, ReferenceLine } from 'recharts';
import { formatEngineering as engFormat } from '../../utils/formatting';

// 다크 / 화이트(캡쳐) 팔레트
const palette = (light) => light ? {
  cardBg: 'bg-white',
  cardBorder: 'border-slate-200',
  title: 'text-slate-900',
  axis: '#475569',
  grid: '#cbd5e1',
  ref: '#94a3b8',
  tooltipBg: '#ffffff',
  tooltipBorder: '#cbd5e1',
  tooltipText: '#0f172a',
  legend: '#475569',
  deflectionStroke: '#0284c7',
  bmdStroke: '#dc2626',
  bmdFill: '#fecaca',
  sfdStroke: '#d97706',
  sfdFill: '#fde68a',
  sMaxStroke: '#7c3aed',
  sMinStroke: '#059669',
} : {
  cardBg: 'bg-slate-950',
  cardBorder: 'border-slate-800',
  title: 'text-white',
  axis: '#94a3b8',
  grid: '#334155',
  ref: '#64748b',
  tooltipBg: '#0f172a',
  tooltipBorder: '#1e293b',
  tooltipText: '#f8fafc',
  legend: '#94a3b8',
  deflectionStroke: '#38bdf8',
  bmdStroke: '#f87171',
  bmdFill: '#7f1d1d',
  sfdStroke: '#fbbf24',
  sfdFill: '#78350f',
  sMaxStroke: '#a78bfa',
  sMinStroke: '#34d399',
};

export default function EngineeringCharts({ dispData, elForceData, stressData, isCapturing, captureMode = null }) {
  const light = isCapturing; // 캡쳐 시 항상 화이트 테마
  const c = palette(light);

  const showDisp   = !captureMode || captureMode === 'full' || captureMode === 'displacement';
  const showForce  = !captureMode || captureMode === 'full';
  const showStress = !captureMode || captureMode === 'full' || captureMode === 'stress';

  return (
    <div className={`${light ? 'bg-transparent' : 'bg-slate-900'} ${isCapturing ? 'flex flex-col gap-6 w-full h-max p-0 overflow-visible' : 'h-[55%] overflow-y-auto custom-scrollbar p-6 space-y-6'}`}>
      {showDisp && dispData.length > 0 && (
        <div className={`${c.cardBg} p-5 rounded-xl border ${c.cardBorder} shrink-0 ${isCapturing ? 'h-[360px]' : 'h-64'}`}>
          <h3 className={`text-sm font-bold ${c.title} mb-4 tracking-wider`}>DEFLECTION (DispZ)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dispData} margin={{ top: 10, right: 20, left: 30, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
              <XAxis dataKey="X[mm]" stroke={c.axis} tick={{fontSize: 11, fill: c.axis}} type="number" domain={['dataMin', 'dataMax']} />
              <YAxis stroke={c.axis} tick={{fontSize: 11, fill: c.axis}} tickFormatter={engFormat} domain={['auto','auto']} />
              <Tooltip contentStyle={{ backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, fontSize: '12px' }} itemStyle={{ color: c.tooltipText }} formatter={(val) => engFormat(val)} />
              <ReferenceLine y={0} stroke={c.ref} strokeWidth={1} />
              <Line isAnimationActive={!isCapturing} type="monotone" dataKey="DispZ[mm]" stroke={c.deflectionStroke} strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {showForce && elForceData.length > 0 && (
        <div className={isCapturing ? "grid grid-cols-2 gap-6 w-full" : "grid grid-cols-2 gap-6 h-64 shrink-0"}>
          <div className={`${c.cardBg} p-5 rounded-xl border ${c.cardBorder} ${isCapturing ? 'h-[320px]' : ''}`}>
            <h3 className={`text-sm font-bold ${c.title} mb-4 tracking-wider`}>BENDING MOMENT DIAGRAM (BMD)</h3>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={elForceData} margin={{ top: 10, right: 10, left: 30, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                <XAxis dataKey="X[mm]" stroke={c.axis} tick={{fontSize: 11, fill: c.axis}} type="number" domain={['dataMin', 'dataMax']} />
                <YAxis stroke={c.axis} tick={{fontSize: 11, fill: c.axis}} tickFormatter={engFormat} />
                <Tooltip contentStyle={{ backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, fontSize: '12px' }} itemStyle={{ color: c.tooltipText }} formatter={(val) => engFormat(val)} />
                <ReferenceLine y={0} stroke={c.ref} strokeWidth={1} />
                <Area isAnimationActive={!isCapturing} type="linear" dataKey="BendingMoment1" stroke={c.bmdStroke} fill={c.bmdFill} fillOpacity={light ? 0.5 : 0.6} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className={`${c.cardBg} p-5 rounded-xl border ${c.cardBorder} ${isCapturing ? 'h-[320px]' : ''}`}>
            <h3 className={`text-sm font-bold ${c.title} mb-4 tracking-wider`}>SHEAR FORCE DIAGRAM (SFD)</h3>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={elForceData} margin={{ top: 10, right: 10, left: 30, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                <XAxis dataKey="X[mm]" stroke={c.axis} tick={{fontSize: 11, fill: c.axis}} type="number" domain={['dataMin', 'dataMax']} />
                <YAxis stroke={c.axis} tick={{fontSize: 11, fill: c.axis}} tickFormatter={engFormat} />
                <Tooltip contentStyle={{ backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, fontSize: '12px' }} itemStyle={{ color: c.tooltipText }} formatter={(val) => engFormat(val)} />
                <ReferenceLine y={0} stroke={c.ref} strokeWidth={1} />
                <Area isAnimationActive={!isCapturing} type="linear" dataKey="ShearForce1" stroke={c.sfdStroke} fill={c.sfdFill} fillOpacity={light ? 0.5 : 0.6} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {showStress && stressData.length > 0 && (
        <div className={`${c.cardBg} p-5 rounded-xl border ${c.cardBorder} shrink-0 ${isCapturing ? 'h-[360px]' : 'h-64'}`}>
          <h3 className={`text-sm font-bold ${c.title} mb-4 tracking-wider`}>STRESS ENVELOPE (Max/Min)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stressData} margin={{ top: 10, right: 20, left: 30, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
              <XAxis dataKey="X[mm]" stroke={c.axis} tick={{fontSize: 11, fill: c.axis}} type="number" domain={['dataMin', 'dataMax']} />
              <YAxis stroke={c.axis} tick={{fontSize: 11, fill: c.axis}} tickFormatter={engFormat} />
              <Tooltip contentStyle={{ backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, fontSize: '12px' }} itemStyle={{ color: c.tooltipText }} formatter={(val) => engFormat(val)} />
              <Legend wrapperStyle={{ color: c.legend, fontSize: '12px' }} />
              <ReferenceLine y={0} stroke={c.ref} strokeWidth={1} />
              <Line isAnimationActive={!isCapturing} type="linear" dataKey="S-MAX[MPa]" stroke={c.sMaxStroke} strokeWidth={2} dot={false} />
              <Line isAnimationActive={!isCapturing} type="linear" dataKey="S-MIN[MPa]" stroke={c.sMinStroke} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
