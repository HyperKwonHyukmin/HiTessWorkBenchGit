import React, { useState } from 'react';
import { Webhook, ChevronDown, ChevronUp, Terminal, CheckCircle, Clock, ArrowRight, Server } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import PageHeader from '../../components/ui/PageHeader';

// ─── 데이터 정의 ──────────────────────────────────────────────────────────────

const API_LIST = [
  {
    id: 'mast-post',
    name: 'Mast Post Assessment',
    method: 'POST',
    endpoint: '/api/davit/mast-post',
    status: 'Active',
    category: '다빗(Davit)',
    description: 'Post 높이와 플랫폼 하중을 입력하면 구조 기준을 만족하는 최적 파이프 후보(1~5순위)를 산출합니다. 결과는 DB에 저장되며 My Projects에서 확인할 수 있습니다.',
    cli: 'PostDavitCalculation.exe mast-post <work_dir> <height_mm> <weight_kg>',
    params: [
      { name: 'height_mm', type: 'float', required: true, desc: 'Post 전체 높이 (mm)' },
      { name: 'weight_kg', type: 'float', required: true, desc: '플랫폼 하중 (kg)' },
      { name: 'employee_id', type: 'string', required: false, desc: '요청 사번 (기본값: "unknown")' },
    ],
    example: JSON.stringify({ height_mm: 3000, weight_kg: 500, employee_id: "20001234" }, null, 2),
  },
  {
    id: 'jib-rest-1dan',
    name: 'Jib Rest Assessment (1단)',
    method: 'POST',
    endpoint: '/api/davit/jib-rest-1dan',
    status: 'Active',
    category: '다빗(Davit)',
    description: 'Jib Rest 1단 구조 설계 계산. Jib 치수·자중·모멘트 팔·높이를 입력하여 기준을 만족하는 단일 파이프 후보를 산출합니다.',
    cli: 'PostDavitCalculation.exe jib-rest-1dan <work_dir> <input_json_path>',
    params: [
      { name: 'jh', type: 'float', required: true, desc: 'Jib 높이 (mm)' },
      { name: 'jb', type: 'float', required: true, desc: 'Jib 폭 (mm)' },
      { name: 'wj', type: 'float', required: true, desc: 'Jib 자중 (kg)' },
      { name: 'ww', type: 'float', required: true, desc: '윈치+받침대 자중 (kg)' },
      { name: 'wc', type: 'float', required: true, desc: '실린더 자중 (kg)' },
      { name: 'lj', type: 'float', required: true, desc: 'Jib 모멘트 팔 (mm)' },
      { name: 'lw', type: 'float', required: true, desc: '윈치 모멘트 팔 (mm)' },
      { name: 'lc', type: 'float', required: true, desc: '실린더 모멘트 팔 (mm)' },
      { name: 'lr', type: 'float', required: true, desc: 'Jib Rest 모멘트 팔 (mm)' },
      { name: 'h1', type: 'float', required: true, desc: 'Jib Rest 전체 높이 (mm)' },
      { name: 'h4', type: 'float', required: true, desc: '플랫폼 높이 (mm)' },
      { name: 'pw', type: 'float', required: true, desc: '플랫폼 자중 (kg)' },
      { name: 'employee_id', type: 'string', required: false, desc: '요청 사번 (기본값: "unknown")' },
    ],
    example: JSON.stringify({ jh: 990, jb: 670, wj: 14500, ww: 1200, wc: 3000, lj: 12074, lw: 4604, lc: 2478, lr: 22100, h1: 9029, h4: 4111, pw: 288, employee_id: "20001234" }, null, 2),
  },
  {
    id: 'jib-rest-2dan',
    name: 'Jib Rest Assessment (2단)',
    method: 'POST',
    endpoint: '/api/davit/jib-rest-2dan',
    status: 'Active',
    category: '다빗(Davit)',
    description: '1단 계산에서 선택한 하단 파이프(D1, T1)를 기반으로 2단 구조를 검토합니다. 1단의 모든 파라미터에 상단 구간 높이(H2), Reducer 높이(H3), 하단 파이프 치수(D1, T1)를 추가로 입력합니다.',
    cli: 'PostDavitCalculation.exe jib-rest-2dan <work_dir> <input_json_path>',
    params: [
      { name: '(1단 파라미터 전체)', type: 'float/string', required: true, desc: '위 1단 요청과 동일한 파라미터 포함' },
      { name: 'h2', type: 'float', required: true, desc: '상단 파이프 구간 높이 (mm)' },
      { name: 'h3', type: 'float', required: true, desc: 'Reducer 높이 (mm)' },
      { name: 'd1', type: 'float', required: true, desc: '하단 파이프 외경 (mm)' },
      { name: 't1', type: 'float', required: true, desc: '하단 파이프 두께 (mm)' },
    ],
    example: JSON.stringify({ jh: 990, jb: 670, wj: 14500, ww: 1200, wc: 3000, lj: 12074, lw: 4604, lc: 2478, lr: 22100, h1: 9029, h4: 4111, pw: 288, h2: 2454, h3: 1000, d1: 762, t1: 7.9, employee_id: "20001234" }, null, 2),
  },
  {
    id: 'truss-model-builder',
    name: 'Truss Model Builder',
    method: 'POST',
    endpoint: '/api/analysis/truss/request',
    status: 'Active',
    category: '파일 기반(File-Based)',
    description: 'CSV 형식의 노드/부재 파일을 업로드하여 트러스 구조 해석 모델(BDF)을 생성합니다. 비동기 처리이며 job_id로 진행 상태를 폴링합니다.',
    cli: 'TrussModelBuilder.exe <exe_dir> <node_csv_path> <member_csv_path>',
    params: [
      { name: 'node_file', type: 'file (CSV)', required: true, desc: '노드 좌표 CSV 파일' },
      { name: 'member_file', type: 'file (CSV)', required: true, desc: '부재 정보 CSV 파일' },
      { name: 'employee_id', type: 'string (form)', required: true, desc: '요청 사번' },
    ],
    example: `curl -X POST ${API_BASE_URL}/api/analysis/truss/request \\
  -F "node_file=@nodes.csv" \\
  -F "member_file=@members.csv" \\
  -F "employee_id=20001234"`,
  },
  {
    id: 'truss-assessment',
    name: 'Truss Structural Assessment',
    method: 'POST',
    endpoint: '/api/analysis/assessment/request',
    status: 'Active',
    category: '파일 기반(File-Based)',
    description: 'Nastran BDF 파일을 업로드하여 트러스 구조 안정성 평가를 수행합니다. 결과는 JSON 및 XLSX 형식으로 제공됩니다. 비동기 처리.',
    cli: 'TrussAssessment.exe <bdf_file_path>',
    params: [
      { name: 'bdf_file', type: 'file (BDF)', required: true, desc: 'Nastran BDF 입력 파일' },
      { name: 'employee_id', type: 'string (form)', required: true, desc: '요청 사번' },
    ],
    example: `curl -X POST ${API_BASE_URL}/api/analysis/assessment/request \\
  -F "bdf_file=@model.bdf" \\
  -F "employee_id=20001234"`,
  },
  {
    id: 'beam-analysis',
    name: 'Beam Analysis (FEM Engine)',
    method: 'POST',
    endpoint: '/api/analysis/beam/request',
    status: 'Active',
    category: '파일 기반(File-Based)',
    description: 'JSON 형식의 보 해석 입력 파일을 업로드하여 FEM 기반 1D 보 해석을 수행합니다. 결과 JSON은 Beam Result Viewer에서 시각화됩니다. 비동기 처리.',
    cli: 'HiTESS.FemEngine.Adapter.exe <input_json_path> <work_dir>',
    params: [
      { name: 'beam_file', type: 'file (JSON)', required: true, desc: '보 해석 입력 JSON 파일' },
      { name: 'employee_id', type: 'string (form)', required: true, desc: '요청 사번' },
    ],
    example: `curl -X POST ${API_BASE_URL}/api/analysis/beam/request \\
  -F "beam_file=@beam_input.json" \\
  -F "employee_id=20001234"`,
  },
];

// ─── 서브 컴포넌트 ─────────────────────────────────────────────────────────────

const MethodBadge = ({ method }) => (
  <span className={`px-2 py-0.5 text-xs font-bold rounded font-mono ${
    method === 'POST' ? 'bg-emerald-100 text-emerald-700' :
    method === 'GET'  ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
  }`}>
    {method}
  </span>
);

const StatusBadge = ({ status }) => (
  <span className={`flex items-center gap-1 px-2.5 py-0.5 text-xs font-bold rounded-full ${
    status === 'Active'     ? 'bg-emerald-50 text-emerald-600' :
    status === 'Developing' ? 'bg-amber-50 text-amber-600' :
                              'bg-slate-100 text-slate-500'
  }`}>
    {status === 'Active' ? <CheckCircle size={11} /> : <Clock size={11} />}
    {status}
  </span>
);

function ApiCard({ api }) {
  const [showExample, setShowExample] = useState(false);
  const isCurl = typeof api.example === 'string' && api.example.startsWith('curl');

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
      {/* 카드 헤더 */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <MethodBadge method={api.method} />
            <StatusBadge status={api.status} />
            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded uppercase tracking-wider">
              {api.category}
            </span>
          </div>
        </div>
        <h3 className="text-base font-bold text-slate-800 mb-1">{api.name}</h3>
        <code className="text-xs text-violet-600 bg-violet-50 px-2 py-1 rounded font-mono break-all">
          {API_BASE_URL}{api.endpoint}
        </code>
      </div>

      {/* 설명 */}
      <div className="px-5 py-4">
        <p className="text-sm text-slate-500 leading-relaxed">{api.description}</p>
      </div>

      {/* CLI 명령어 */}
      {api.cli && (
        <div className="px-5 pb-4">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">CLI Command</p>
          <code className="block bg-slate-900 text-amber-300 text-xs rounded-xl p-3 font-mono break-all">
            $ {api.cli}
          </code>
        </div>
      )}

      {/* 파라미터 테이블 */}
      <div className="px-5 pb-4">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Request Parameters</p>
        <div className="overflow-x-auto rounded-lg border border-gray-100">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold">
                <td className="px-3 py-2">이름</td>
                <td className="px-3 py-2">타입</td>
                <td className="px-3 py-2">필수</td>
                <td className="px-3 py-2">설명</td>
              </tr>
            </thead>
            <tbody>
              {api.params.map((p, i) => (
                <tr key={i} className="border-t border-gray-100 text-slate-600">
                  <td className="px-3 py-2 font-mono font-bold text-violet-700">{p.name}</td>
                  <td className="px-3 py-2 font-mono text-slate-500">{p.type}</td>
                  <td className="px-3 py-2">
                    {p.required
                      ? <span className="text-emerald-600 font-bold">✓</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2">{p.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Request 예시 (collapsible) */}
      <div className="px-5 pb-5 mt-auto">
        <button
          onClick={() => setShowExample(v => !v)}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-violet-600 transition-colors cursor-pointer"
        >
          <Terminal size={13} />
          {isCurl ? 'Request 예시 (curl)' : 'Request 예시 (JSON)'}
          {showExample ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showExample && (
          <pre className="mt-2 bg-slate-900 text-emerald-300 text-xs rounded-xl p-4 overflow-x-auto font-mono leading-relaxed">
            {api.example}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function ApiApps() {
  const [showArch, setShowArch] = useState(true);

  return (
    <div className="max-w-7xl mx-auto pb-16">
      <PageHeader
        title="API Apps"
        icon={Webhook}
        subtitle="클라이언트 exe 또는 외부 프로그램이 워크벤치 백엔드를 직접 호출하는 API 목록입니다. 사용 방법과 파라미터 명세를 확인하세요."
        accentColor="violet"
      />

      {/* 아키텍처 설명 */}
      <div className="mb-6 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <button
          onClick={() => setShowArch(v => !v)}
          className="w-full flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <Server size={16} className="text-violet-500" />
            작동 방식 (How It Works)
          </div>
          {showArch ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>

        {showArch && (
          <div className="border-t border-gray-100 px-6 py-6">
            {/* 아키텍처 다이어그램 */}
            <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
              {[
                { label: 'Client PC', sub: '사용자 로컬 환경', color: 'bg-slate-100 border-slate-300 text-slate-700' },
                null,
                { label: 'Client .exe', sub: '클라이언트 실행 파일', color: 'bg-violet-50 border-violet-300 text-violet-700' },
                null,
                { label: 'WorkBench Backend', sub: 'FastAPI 서버', color: 'bg-blue-50 border-blue-300 text-blue-700' },
                null,
                { label: 'DB 저장', sub: 'My Projects 이력', color: 'bg-emerald-50 border-emerald-300 text-emerald-700' },
              ].map((item, i) =>
                item === null ? (
                  <ArrowRight key={i} size={20} className="text-slate-300 shrink-0" />
                ) : (
                  <div key={i} className={`border rounded-xl px-4 py-3 text-center min-w-[120px] ${item.color}`}>
                    <div className="text-sm font-bold">{item.label}</div>
                    <div className="text-[11px] opacity-70 mt-0.5">{item.sub}</div>
                  </div>
                )
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="font-bold text-slate-700 mb-1">① 클라이언트 실행</p>
                <p className="text-slate-500 text-xs leading-relaxed">
                  사용자 PC에 설치된 <code className="bg-white px-1 rounded text-violet-600 font-mono">HiTESS_Client.exe</code> 또는
                  연동 프로그램에서 CMD 명령어로 클라이언트를 호출합니다.
                </p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="font-bold text-slate-700 mb-1">② HTTP 요청 전송</p>
                <p className="text-slate-500 text-xs leading-relaxed">
                  클라이언트 exe가 JSON 바디 또는 multipart form을 구성하여 워크벤치 백엔드의 REST API 엔드포인트로
                  <code className="bg-white px-1 rounded text-emerald-600 font-mono">HTTP POST</code> 요청을 보냅니다.
                </p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="font-bold text-slate-700 mb-1">③ 결과 저장 및 반환</p>
                <p className="text-slate-500 text-xs leading-relaxed">
                  백엔드가 계산을 수행하고 결과를 DB에 저장합니다.
                  응답 JSON을 클라이언트로 반환하며, <strong>My Projects</strong> 페이지에서 이력을 확인할 수 있습니다.
                </p>
              </div>
            </div>

            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
              <strong>서버 주소 확인:</strong> 클라이언트 exe 설정에서 백엔드 URL을
              현재 서버 주소(<code className="font-mono">{API_BASE_URL}</code>)와 일치시켜야 합니다.
              레이아웃 상단의 서버 설정 버튼에서 변경 가능합니다.
            </div>
          </div>
        )}
      </div>

      {/* API 카드 그리드 */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">
          등록된 API — {API_LIST.length}개
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {API_LIST.map(api => (
          <ApiCard key={api.id} api={api} />
        ))}
      </div>
    </div>
  );
}
