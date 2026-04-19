import React, { useState, useEffect, useMemo } from 'react';
import { Database, Layers, GitMerge, Box, FileText, RotateCcw, CheckCircle2, AlertCircle, Tag } from 'lucide-react';

function EmptyState({ msg, Icon }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 bg-white">
      <Icon size={48} className="mb-4 opacity-20" />
      <p className="text-sm font-bold text-center px-10 leading-relaxed">{msg}</p>
    </div>
  );
}

function StatBadge({ label, value, color }) {
  const palette = {
    blue:  'bg-blue-50  text-blue-700  border-blue-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red:   'bg-red-50   text-red-700   border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  return (
    <div className={`flex flex-col items-center px-3 py-1.5 rounded-lg border min-w-[72px] ${palette[color] || palette.slate}`}>
      <span className="text-[9px] font-bold uppercase tracking-wider opacity-60 whitespace-nowrap">{label}</span>
      <span className="text-sm font-black font-mono">{value}</span>
    </div>
  );
}

const SIDE_SUPPORT_ALLOWABLE = 100800;

function AssessmentTable({ data, section }) {
  const [sortConfig, setSortConfig] = useState(null);
  if (!data || data.length === 0) return <EmptyState msg="데이터가 없습니다." Icon={FileText} />;

  const headers = Object.keys(data[0]);
  const sortedData = sortConfig
    ? [...data].sort((a, b) => {
        const an = parseFloat(a[sortConfig.key]); const bn = parseFloat(b[sortConfig.key]);
        if (!isNaN(an) && !isNaN(bn)) return sortConfig.dir === 'asc' ? an - bn : bn - an;
        return sortConfig.dir === 'asc'
          ? String(a[sortConfig.key]).localeCompare(String(b[sortConfig.key]))
          : String(b[sortConfig.key]).localeCompare(String(a[sortConfig.key]));
      })
    : data;

  const handleSort = (col) => setSortConfig(prev =>
    prev?.key === col ? { key: col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key: col, dir: 'asc' }
  );

  const formatCell = (header, val) => {
    if (val === null || val === undefined) return '—';
    if (header === 'result') return val;
    if (header === 'allowable') {
      const num = parseFloat(val);
      if (!isNaN(num)) return `${Math.round(num).toLocaleString()} N`;
      return String(val);
    }
    const num = parseFloat(val);
    if (!isNaN(num)) {
      if (['element','set','property','leg','support','loadCaseIndex'].includes(header)) return String(Math.round(num));
      return num.toFixed(2);
    }
    return String(val);
  };

  const getCellClass = (header, val, row) => {
    if (header === 'assessment') {
      const n = parseFloat(val);
      if (n >= 1.0) return 'text-red-600 font-bold';
      if (n >= 0.8) return 'text-amber-600 font-bold';
      return 'text-slate-700';
    }
    if (header === 'reactionForce' && row) {
      const rf = parseFloat(val);
      if (section === 'panel' && !isNaN(rf) && rf < 0) return 'text-red-600 font-bold';
      const panelType = row.panel || '';
      const allowKey = panelType === 'BF-02' ? 'allowBF02' : panelType === 'BF-06' ? 'allowBF06' : 'allowBF03';
      const allow = parseFloat(row[allowKey]) || Infinity;
      const ratio = Math.abs(rf || 0) / allow;
      if (ratio >= 1.0) return 'text-red-600 font-bold';
      if (ratio >= 0.8) return 'text-amber-600 font-bold';
    }
    if (section === 'support' && (header === 'reaction' || header === 'reactionForce')) {
      const r = Math.abs(parseFloat(val) || 0);
      if (r > SIDE_SUPPORT_ALLOWABLE) return 'text-red-600 font-bold';
    }
    return 'text-slate-700';
  };

  const getColHeader = (h) => {
    const map = {
      element: 'Element', set: 'Set', property: 'Property',
      axial: 'Axial', bending: 'Bending',
      allowAxial: 'Allow Axial', allowBending: 'Allow Bending',
      assessment: 'Assessment', result: 'Result',
      leg: 'Leg', condition: 'Condition',
      reactionForce: 'Reaction Force',
      allowBF03: 'Allow BF-03', allowBF02: 'Allow BF-02', allowBF06: 'Allow BF-06',
      panel: 'Panel Type',
      support: 'Support Node', reaction: 'Reaction',
      allowable: 'Allowable',
      loadCaseId: 'LC',
    };
    return map[h] || h;
  };

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <div className="px-4 py-1.5 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between shrink-0">
        <span className="text-xs font-bold text-emerald-700">{sortedData.length.toLocaleString()}개 항목</span>
        {sortConfig && (
          <button onClick={() => setSortConfig(null)} className="text-[11px] text-slate-400 hover:text-red-500 cursor-pointer flex items-center gap-1">
            <RotateCcw size={10}/> 정렬 초기화
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-sm font-mono whitespace-nowrap">
          <thead className="sticky top-0 bg-slate-50 z-10 shadow-sm">
            <tr>
              <th className="px-3 py-3 text-slate-400 font-bold text-xs border-b border-emerald-200 w-10 text-center">#</th>
              {headers.map((h) => (
                <th key={h} onClick={() => handleSort(h)} className={`px-4 py-3 font-bold uppercase tracking-wider text-xs border-b border-emerald-200 cursor-pointer hover:bg-emerald-100 select-none ${h === 'result' ? 'text-center text-emerald-800' : 'text-emerald-800'}`}>
                  <span className="flex items-center gap-1">
                    {getColHeader(h)}
                    {sortConfig?.key === h ? (sortConfig.dir === 'asc' ? ' ↑' : ' ↓') : <span className="text-slate-300 text-[10px]">⇅</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {sortedData.map((row, i) => {
              const isFail = row.result !== undefined && row.result !== null && row.result !== 'OK';
              return (
                <tr key={i} className={`transition-colors ${isFail ? 'bg-red-100 hover:bg-red-200/70' : 'hover:bg-emerald-50/60'}`}>
                  <td className="px-3 py-2 text-slate-400 text-xs text-center">{i + 1}</td>
                  {headers.map((h) => (
                    <td key={h} className={`px-4 py-2 ${getCellClass(h, row[h], row)}`}>
                      {h === 'result' ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-black ${row[h] === 'OK' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {row[h] === 'OK' ? <CheckCircle2 size={10} className="mr-1"/> : <AlertCircle size={10} className="mr-1"/>}
                          {row[h]}
                        </span>
                      ) : formatCell(h, row[h])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DynamicJsonDataTable({ data, emptyMsg }) {
  const [sortConfig, setSortConfig] = useState(null);
  if (!data) return <EmptyState msg={emptyMsg} Icon={FileText} />;

  let tableData = [];
  if (Array.isArray(data)) {
    tableData = data;
  } else if (typeof data === 'object') {
    const arrayKey = Object.keys(data).find(key => Array.isArray(data[key]));
    if (arrayKey) {
      tableData = data[arrayKey];
    } else {
      tableData = Object.entries(data).map(([key, value]) => ({
        Key: key, Value: typeof value === 'object' ? JSON.stringify(value) : String(value)
      }));
    }
  }
  if (tableData.length === 0) return <EmptyState msg={emptyMsg} Icon={FileText} />;

  const headers = Object.keys(tableData[0]);
  const handleSort = (col) => setSortConfig(prev =>
    prev?.key === col ? { key: col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key: col, dir: 'asc' }
  );
  const sortedData = sortConfig
    ? [...tableData].sort((a, b) => {
        const aNum = parseFloat(a[sortConfig.key]); const bNum = parseFloat(b[sortConfig.key]);
        if (!isNaN(aNum) && !isNaN(bNum)) return sortConfig.dir === 'asc' ? aNum - bNum : bNum - aNum;
        return sortConfig.dir === 'asc'
          ? String(a[sortConfig.key]).localeCompare(String(b[sortConfig.key]))
          : String(b[sortConfig.key]).localeCompare(String(a[sortConfig.key]));
      })
    : tableData;

  const formatCell = (val) => {
    if (val === null || val === undefined) return '-';
    if (typeof val === 'object') return JSON.stringify(val);
    const num = parseFloat(val);
    if (!isNaN(num) && String(val).trim() !== '') return Number.isInteger(num) ? String(num) : num.toFixed(2);
    return String(val);
  };

  const isHighValue = (header, val) => {
    const lh = header.toLowerCase();
    if (lh.includes('ratio') || lh.includes('util') || lh.includes('dcr') || lh.includes('ur')) {
      const num = parseFloat(val);
      return !isNaN(num) && num >= 1.0;
    }
    return false;
  };

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-white">
      <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between shrink-0">
        <span className="text-xs font-bold text-emerald-700">전체 <span className="text-emerald-900">{sortedData.length.toLocaleString()}</span>개 항목{' · '}<span className="text-emerald-600">{headers.length}개 컬럼</span></span>
        {sortConfig && (
          <button onClick={() => setSortConfig(null)} className="text-xs text-slate-400 hover:text-red-500 cursor-pointer flex items-center gap-1">
            <RotateCcw size={11}/> 정렬 초기화
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-sm font-mono whitespace-nowrap">
          <thead className="sticky top-0 bg-slate-50 z-10 shadow-sm">
            <tr>
              <th className="px-4 py-3 text-slate-400 font-bold text-xs border-b border-emerald-200 w-12 text-center">#</th>
              {headers.map((h, i) => (
                <th key={i} onClick={() => handleSort(h)} className="px-5 py-3 text-emerald-800 font-bold uppercase tracking-wider text-xs border-b border-emerald-200 cursor-pointer hover:bg-emerald-100 select-none">
                  <span className="flex items-center gap-1">
                    {h}
                    {sortConfig?.key === h ? (sortConfig.dir === 'asc' ? ' ↑' : ' ↓') : <span className="text-slate-300 text-[10px]">⇅</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {sortedData.map((row, i) => (
              <tr key={i} className="hover:bg-emerald-50/60 transition-colors">
                <td className="px-4 py-2 text-slate-400 text-xs text-center">{i + 1}</td>
                {headers.map((h, j) => (
                  <td key={j} className={`px-5 py-2 ${isHighValue(h, row[h]) ? 'text-red-600 font-bold bg-red-50' : 'text-slate-700'}`}>
                    {formatCell(row[h])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LoadCaseViewer({ data }) {
  const tabs = useMemo(() => {
    if (!data?.loadCases) return [];
    const sections = [
      { key: 'summary',  label: 'Summary',  icon: Database, getData: lc => lc.summary           || [] },
      { key: 'elements', label: 'Elements', icon: Layers,   getData: lc => lc.elementAssessment || [] },
      { key: 'panel',    label: 'Panel',    icon: GitMerge, getData: lc => lc.distributionPanel || [] },
      { key: 'support',  label: 'Support',  icon: Box,      getData: lc => (lc.sideSupport || []).map(row => {
        const reactionRaw = row.reaction ?? row.reactionForce;
        const r = Math.abs(parseFloat(reactionRaw) || 0);
        return { ...row, allowable: SIDE_SUPPORT_ALLOWABLE, result: r > SIDE_SUPPORT_ALLOWABLE ? 'Fail' : 'OK' };
      }) },
    ];
    const result = [];
    data.loadCases.forEach((lc, lcIdx) => {
      sections.forEach(({ key, label, icon, getData }) => {
        const rows = getData(lc);
        if (rows.length === 0) return;
        const failCount = rows.filter(r => r.result && r.result !== 'OK').length;
        result.push({ id: `${lcIdx}-${key}`, lcIdx, lcId: lc.loadCaseIndex, section: key, label: `LC${lc.loadCaseIndex} ${label}`, icon, rows, failCount, isFirstOfLc: !result.some(t => t.lcIdx === lcIdx) });
      });
    });
    return result;
  }, [data]);

  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '');
  useEffect(() => { if (tabs.length > 0) setActiveTabId(tabs[0].id); }, [data]);

  if (!tabs.length) return <EmptyState msg="Load Case 데이터가 없습니다." Icon={FileText} />;

  const activeTab  = tabs.find(t => t.id === activeTabId) ?? tabs[0];
  const activeLc   = data.loadCases[activeTab.lcIdx];
  const elemData   = activeLc?.elementAssessment || [];
  const panelData  = activeLc?.distributionPanel || [];
  const totalElem  = elemData.length;
  const failedElem = elemData.filter(r => r.result !== 'OK').length;
  const maxAssmt   = totalElem > 0 ? Math.max(...elemData.map(r => parseFloat(r.assessment) || 0)) : 0;
  const passRate   = totalElem > 0 ? (((totalElem - failedElem) / totalElem) * 100).toFixed(1) : '—';
  const panelFail  = panelData.filter(r => r.result !== 'OK').length;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-white">
      <div className="flex gap-0.5 px-2 pt-2 bg-slate-50 border-b border-slate-200 shrink-0 overflow-x-auto">
        {tabs.map((tab, i) => {
          const isActive = tab.id === activeTabId;
          const isFail = tab.failCount > 0;
          const showDivider = i > 0 && tabs[i - 1]?.lcIdx !== tab.lcIdx;
          return (
            <React.Fragment key={tab.id}>
              {showDivider && <div className="w-px bg-slate-300 mx-1 my-1.5 shrink-0" />}
              <button
                onClick={() => setActiveTabId(tab.id)}
                className={`relative px-3 py-2 rounded-t-lg text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 shrink-0 ${
                  isActive
                    ? isFail ? 'bg-white text-red-600 border border-b-white border-slate-200 shadow-sm -mb-px' : 'bg-white text-emerald-700 border border-b-white border-slate-200 shadow-sm -mb-px'
                    : isFail ? 'text-red-500 hover:bg-red-50 border border-transparent' : 'text-slate-500 hover:bg-slate-200 border border-transparent'
                }`}
              >
                <tab.icon size={11} className="shrink-0"/>
                {tab.label}
                {isFail && <span className="inline-flex items-center justify-center min-w-[14px] h-3.5 px-0.5 rounded-full bg-red-500 text-white text-[8px] font-black">{tab.failCount}</span>}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-100 shrink-0 flex-wrap">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider mr-1">LC {activeTab.lcId}</span>
        <StatBadge label="Members"     value={`${totalElem.toLocaleString()} ea`} color="blue" />
        <StatBadge label="Member FAIL" value={failedElem}  color={failedElem > 0 ? 'red' : 'green'} />
        <StatBadge label="Pass Rate"   value={`${passRate}%`} color={parseFloat(passRate) >= 100 ? 'green' : 'amber'} />
        <StatBadge label="Max Assess." value={maxAssmt.toFixed(2)} color={maxAssmt >= 1.0 ? 'red' : maxAssmt >= 0.8 ? 'amber' : 'green'} />
        {panelData.length > 0 && <>
          <div className="w-px h-8 bg-slate-200 mx-1"/>
          <StatBadge label="Panel" value={`${panelData.length} ea`} color="blue" />
          <StatBadge label="Panel FAIL" value={panelFail} color={panelFail > 0 ? 'red' : 'green'} />
        </>}
        {(activeLc?.sideSupport || []).length > 0 && <>
          <div className="w-px h-8 bg-slate-200 mx-1"/>
          <StatBadge label="Side Support" value={`${activeLc.sideSupport.length} ea`} color="slate" />
        </>}
      </div>

      <div className="flex-1 relative overflow-hidden">
        <AssessmentTable key={activeTab.id} data={activeTab.rows} section={activeTab.section} />
      </div>
    </div>
  );
}

export default function MultiJsonViewer({ resultsMap, activeCase, setActiveCase }) {
  const caseNames = useMemo(() => Object.keys(resultsMap), [resultsMap]);
  const currentData = resultsMap[activeCase];
  const isLoadCaseFormat = currentData?.loadCases !== undefined;

  return (
    <div className="flex flex-col h-full bg-white">
      {caseNames.length > 1 && (
        <div className="flex gap-2 p-3 border-b border-slate-100 bg-slate-50 shrink-0 overflow-x-auto">
          {caseNames.map(name => (
            <button key={name} onClick={() => setActiveCase(name)}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${activeCase === name ? 'bg-emerald-600 text-white shadow-md' : 'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50'}`}>
              <Tag size={14} /> {name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 relative overflow-hidden bg-white">
        {isLoadCaseFormat
          ? <LoadCaseViewer data={currentData} />
          : <DynamicJsonDataTable data={currentData} emptyMsg={`${activeCase}에 표시할 데이터가 없습니다.`} />
        }
      </div>
    </div>
  );
}
