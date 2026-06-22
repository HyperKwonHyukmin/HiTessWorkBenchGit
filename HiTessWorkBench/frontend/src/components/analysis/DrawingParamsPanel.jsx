/**
 * DrawingParamsPanel — 설계 파라미터 편집 + 모델 재구축.
 *
 * UI:
 *   - 1열 그리드 (좁은 사이드바 적합)
 *   - 필드 포커스/클릭 시 onFieldFocus(key) 호출 → 모델 뷰어가 해당 부위 굵은 선 하이라이트
 *
 * 제외 필드: name / material / mesh_size / safe_load_kg / pdf_page
 *   (제외된 값은 params 객체에는 포함되어 백엔드로 전달됨 — UI 노출만 차단)
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Sliders, RefreshCw, Loader2, AlertCircle, ChevronDown, ChevronUp, AlertTriangle,
} from 'lucide-react';
import { rebuildDrawingModel } from '../../api/analysis';
import { useToast } from '../../contexts/ToastContext';

// ── 모드별 편집 가능 필드 ────────────────────────────────────────────
const LUG_FIELDS = [
  { key: 'thickness',            label: '두께',                            unit: 'mm' },
  { key: 'height',               label: '높이',                            unit: 'mm' },
  { key: 'lap_length',           label: 'Lap 길이',                        unit: 'mm' },
  { key: 'neck_length',          label: 'Neck 길이',                       unit: 'mm' },
  { key: 'hole_diameter',        label: '구멍 직경',                       unit: 'mm' },
  { key: 'outer_radius',         label: '외곽 반경',                       unit: 'mm' },
  { key: 'left_to_hole_center',  label: '좌측 → 구멍 중심',                unit: 'mm' },
  { key: 'chamfer_dx',           label: '좌측 모서리 chamfer 가로 (dx)',   unit: 'mm', hint: '좌측 끝 → 모서리 깎임 종료점' },
  { key: 'chamfer_y',            label: '좌측 모서리 chamfer 세로 (y)',    unit: 'mm', hint: '상/하 모서리 → 깎임 시작점' },
];

const IMAGE_LUG_FIELDS = [
  { key: 'thickness',            label: '두께',                 unit: 'mm' },
  { key: 'height',               label: '폭/높이 W',            unit: 'mm', hint: '이미지 도면의 폭 방향 치수입니다. 내부 필드명은 height 입니다.' },
  { key: 'drawing_overall_h',    label: '전체 길이/높이 L',     unit: 'mm', hint: '가로형 도면에서는 전체 길이, 세로형 도면에서는 전체 높이입니다.' },
  { key: 'hole_diameter',        label: '구멍 직경',            unit: 'mm' },
  { key: 'outer_radius',         label: '외곽 반경 R',          unit: 'mm' },
  { key: 'left_to_hole_center',  label: '기준선 → 구멍 중심',   unit: 'mm', hint: '이미지 도면의 center 치수입니다.' },
];

const SUPPORT_FIELDS = [
  { key: 'pipe_outer_diameter',   label: '파이프 외경',           unit: 'mm' },
  { key: 'pipe_length',           label: '파이프 길이',           unit: 'mm' },
  { key: 'pipe_thickness',        label: '파이프 두께',           unit: 'mm' },
  { key: 'top_plate_diameter',    label: '상부 플레이트 직경',    unit: 'mm' },
  { key: 'bottom_plate_diameter', label: '하부 플레이트 직경',    unit: 'mm' },
  { key: 'plate_thickness',       label: '플레이트 두께',         unit: 'mm' },
  { key: 'rib_size',              label: '리브 크기',             unit: 'mm' },
  { key: 'rib_thickness',         label: '리브 두께',             unit: 'mm' },
  { key: 'small_rib_size',        label: '소형 리브 크기',        unit: 'mm' },
];

/* ──────────────────────────────────────────────────────────────────────────
   설계값 검증 — 말이 안 되는 조합 차단
   각 함수 반환값: { [fieldKey]: '오류 메시지' }
   ──────────────────────────────────────────────────────────────────────── */

function validateLugParams(p) {
  const e = {};
  const num = (k) => Number(p[k] ?? 0);
  const t   = num('thickness');
  const h   = num('height');
  const lap = num('lap_length');
  const nck = num('neck_length');
  const hd  = num('hole_diameter');
  const oR  = num('outer_radius');
  const lhc = num('left_to_hole_center');
  const cdx = num('chamfer_dx');
  const cy  = num('chamfer_y');
  const isImageLug = p?.source_kind === 'image';
  const overallH = Number(p.drawing_overall_h ?? 0);

  // 0 이하 차단
  if (t   <= 0) e.thickness            = '0 보다 커야 합니다.';
  if (h   <= 0) e.height               = '0 보다 커야 합니다.';
  if (lap <= 0) e.lap_length           = '0 보다 커야 합니다.';
  if (nck <= 0) e.neck_length          = '0 보다 커야 합니다.';
  if (hd  <= 0) e.hole_diameter        = '0 보다 커야 합니다.';
  if (oR  <= 0) e.outer_radius         = '0 보다 커야 합니다.';
  if (lhc <= 0) e.left_to_hole_center  = '0 보다 커야 합니다.';
  if (cdx <  0) e.chamfer_dx           = '음수일 수 없습니다.';
  if (cy  <  0) e.chamfer_y            = '음수일 수 없습니다.';
  if (isImageLug && overallH <= 0)
    e.drawing_overall_h = '0 보다 커야 합니다.';

  // 기하 일관성
  if (hd >= oR * 2)
    e.hole_diameter = `구멍 직경(${hd})은 외곽 직경(${(oR*2).toFixed(1)})보다 작아야 합니다.`;
  if (oR * 2 > h + 0.01)
    e.outer_radius  = `외곽 직경(${(oR*2).toFixed(1)})이 높이(${h})를 초과합니다.`;
  if (hd / 2 > lhc)
    e.left_to_hole_center = `구멍이 좌측 경계를 벗어납니다 (직경/2 > 거리).`;
  if (lhc < lap)
    e.left_to_hole_center = `구멍 중심은 Lap 영역 우측에 있어야 합니다 (≥ ${lap}).`;
  if (cdx > lap / 2)
    e.chamfer_dx = `Chamfer dx 는 Lap 길이의 절반(${(lap/2).toFixed(1)}) 이하여야 합니다.`;
  if (cy > h / 2)
    e.chamfer_y = `Chamfer y 는 높이의 절반(${(h/2).toFixed(1)}) 이하여야 합니다.`;
  if (isImageLug && overallH > 0 && overallH < Math.max(h, lhc + hd / 2))
    e.drawing_overall_h = `전체 높이 H는 폭 W와 구멍 위치를 포함해야 합니다.`;

  return e;
}

function validateSupportParams(p) {
  const e = {};
  const num = (k) => Number(p[k] ?? 0);
  const pod = num('pipe_outer_diameter');
  const pl  = num('pipe_length');
  const pt  = num('pipe_thickness');
  const tpd = num('top_plate_diameter');
  const bpd = num('bottom_plate_diameter');
  const plt = num('plate_thickness');
  const rs  = num('rib_size');
  const rt  = num('rib_thickness');
  const srs = num('small_rib_size');

  [
    ['pipe_outer_diameter',   pod, '파이프 외경'],
    ['pipe_length',           pl,  '파이프 길이'],
    ['pipe_thickness',        pt,  '파이프 두께'],
    ['top_plate_diameter',    tpd, '상부 플레이트 직경'],
    ['bottom_plate_diameter', bpd, '하부 플레이트 직경'],
    ['plate_thickness',       plt, '플레이트 두께'],
    ['rib_size',              rs,  '리브 크기'],
    ['rib_thickness',         rt,  '리브 두께'],
    ['small_rib_size',        srs, '소형 리브 크기'],
  ].forEach(([k, v]) => { if (v <= 0) e[k] = '0 보다 커야 합니다.'; });

  // 기하 일관성
  if (pt >= pod / 2)
    e.pipe_thickness = `파이프 두께(${pt})는 외경 반경(${(pod/2).toFixed(1)})보다 작아야 합니다.`;
  if (tpd > 0 && pod > 0 && tpd < pod)
    e.top_plate_diameter = `상부 플레이트 직경은 파이프 외경(${pod}) 이상이어야 합니다.`;
  if (bpd > 0 && pod > 0 && bpd < pod)
    e.bottom_plate_diameter = `하부 플레이트 직경은 파이프 외경(${pod}) 이상이어야 합니다.`;
  if (plt > 0 && pl > 0 && plt >= pl)
    e.plate_thickness = `플레이트 두께가 파이프 길이(${pl})를 초과할 수 없습니다.`;
  if (srs > 0 && rs > 0 && srs > rs)
    e.small_rib_size = `소형 리브 크기는 일반 리브 크기(${rs}) 이하여야 합니다.`;

  return e;
}

function validateParams(mode, params) {
  return mode === 'support' ? validateSupportParams(params) : validateLugParams(params);
}

export default function DrawingParamsPanel({
  params, mode, workDir, originalPdfPath, employeeId,
  onRebuildStarted, onFieldFocus, disabled, highlightedKey,
}) {
  const isImageLug = mode !== 'support' && params?.source_kind === 'image';
  const fields = useMemo(() => {
    if (mode === 'support') return SUPPORT_FIELDS;
    if (isImageLug) return IMAGE_LUG_FIELDS;
    return LUG_FIELDS;
  }, [mode, isImageLug]);
  const [values, setValues] = useState({});
  const [collapsed, setCollapsed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    if (!params) { setValues({}); return; }
    const next = {};
    fields.forEach(({ key }) => { if (key in params) next[key] = params[key]; });
    setValues(next);
  }, [params, fields]);

  const setField = (key, raw) => {
    // 문자열 그대로 저장 — 사용자가 "1500." 또는 "1500.05" 같은 임시 입력을 유지할 수 있도록
    // Number() 변환은 rebuild payload 생성 시점에 일괄 수행
    setValues((prev) => ({ ...prev, [key]: raw }));
  };

  const handleReset = () => {
    if (!params) return;
    const next = {};
    fields.forEach(({ key }) => { if (key in params) next[key] = params[key]; });
    setValues(next);
  };

  // 실시간 검증 — 사용자가 값 입력할 때마다 invalid 표시 + 재구축 차단
  const fieldErrors = useMemo(() => {
    const merged = { ...params, ...values };
    return validateParams(mode, merged);
  }, [params, values, mode]);

  const hasErrors = Object.keys(fieldErrors).length > 0;

  const handleRebuild = async () => {
    setError('');
    for (const f of fields) {
      const v = values[f.key];
      if (v === '' || v == null || Number.isNaN(Number(v))) {
        setError(`'${f.label}' 값이 비어 있거나 숫자가 아닙니다.`);
        return;
      }
    }
    if (hasErrors) {
      setError('설계값 일관성 오류가 있습니다. 빨간 표시 필드를 수정하세요.');
      return;
    }
    // params 전체(편집되지 않은 hidden 필드 포함) + 편집된 값을 병합
    // values 는 문자열로 저장되어 있을 수 있으므로 숫자로 일괄 변환
    const payload = { ...params };
    Object.entries(values).forEach(([k, raw]) => {
      if (raw === '' || raw == null) return;
      const n = Number(raw);
      payload[k] = Number.isFinite(n) ? n : raw;
    });
    setSubmitting(true);
    try {
      const res = await rebuildDrawingModel({
        employeeId,
        workDir,
        mode,
        params: payload,
        originalPdfPath: mode === 'support' ? originalPdfPath : null,
      });
      const jobId = res.data?.job_id;
      if (!jobId) throw new Error('재구축 작업 ID를 받지 못했습니다.');
      onRebuildStarted?.(jobId);
      showToast('모델 재구축을 시작했습니다.', 'info');
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : (e?.message || '재구축 실패');
      setError(msg);
      showToast(`재구축 요청 실패: ${msg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!params) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* 헤더 — 접힘 토글 */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-violet-50 to-white border-b border-violet-100 hover:bg-violet-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-1.5">
          <Sliders size={12} className="text-violet-600" />
          <span className="text-[11px] font-bold text-slate-700">설계 파라미터</span>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ml-1 ${
            mode === 'support' ? 'bg-indigo-100 text-indigo-600' : 'bg-blue-100 text-blue-600'
          }`}>
            {mode}
          </span>
          {Object.keys(fieldErrors).length > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-600 ml-0.5">
              {Object.keys(fieldErrors).length} 오류
            </span>
          )}
        </div>
        {collapsed
          ? <ChevronDown size={12} className="text-slate-400" />
          : <ChevronUp size={12} className="text-slate-400" />}
      </button>

      {!collapsed && (
        <div className="p-3 space-y-2">
          {/* 사용 힌트 */}
          <p className="text-[10px] text-slate-400 leading-relaxed">
            필드 위에 마우스를 올리거나 클릭하면 모델에서 해당 부위가 강조됩니다. 수정 후 재구축하세요.
          </p>

          {/* 파라미터 목록 */}
          <div className="flex flex-col gap-1">
            {fields.map((f) => {
              const v = values[f.key] ?? (params[f.key] ?? '');
              // 모든 숫자 값은 소수점 한 자리로 통일 표시 (1500 → "1500.0", 12.75 → "12.8")
              // type="number" 는 trailing zero 를 브라우저가 제거하므로 type="text" + inputMode="decimal" 사용
              const display = typeof v === 'number' && Number.isFinite(v)
                ? v.toFixed(1)
                : (v ?? '');
              const isActive  = highlightedKey === f.key;
              const fieldErr  = fieldErrors[f.key];
              const isInvalid = !!fieldErr;
              return (
                <div key={f.key}>
                  <label
                    onMouseEnter={() => onFieldFocus?.(f.key)}
                    onMouseLeave={() => onFieldFocus?.(null)}
                    className={`flex flex-col gap-0.5 px-2 py-1 rounded-lg border transition-colors cursor-pointer ${
                      isInvalid
                        ? 'border-rose-200 bg-rose-50'
                        : isActive
                        ? 'border-violet-300 bg-violet-50 shadow-sm'
                        : 'border-transparent hover:border-violet-100 hover:bg-violet-50/40'
                    }`}
                    title={f.hint || ''}
                  >
                    <div className="flex items-center gap-2">
                      {/* 상태 점 */}
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isInvalid ? 'bg-rose-400' : isActive ? 'bg-violet-500' : 'bg-slate-200'
                      }`} />
                      {/* 라벨 */}
                      <span className="flex-1 min-w-0 text-[11px] text-slate-600 flex items-center gap-1">
                        <span className="truncate">{f.label}</span>
                        {isInvalid && <AlertTriangle size={9} className="text-rose-400 shrink-0" />}
                      </span>
                      {/* 숫자 입력 — type="text" + inputMode="decimal" 로 소수점 한 자리 trailing zero 보장 */}
                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*\.?[0-9]*"
                        value={display}
                        disabled={disabled}
                        onFocus={() => onFieldFocus?.(f.key)}
                        onClick={() => onFieldFocus?.(f.key)}
                        onChange={(e) => {
                          const raw = e.target.value;
                          // 숫자/소수점/공백만 허용 (사용자 편집 중 부분 입력 허용)
                          if (raw === '' || /^[0-9]*\.?[0-9]*$/.test(raw)) {
                            setField(f.key, raw);
                          }
                        }}
                        className={`w-[72px] text-xs font-mono px-1.5 py-0.5 rounded border text-right transition-colors ${
                          isInvalid
                            ? 'border-rose-300 bg-white text-rose-700 focus:ring-1 focus:ring-rose-200'
                            : isActive
                            ? 'border-violet-300 ring-1 ring-violet-100 bg-white'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        } focus:outline-none disabled:bg-slate-50 disabled:text-slate-400`}
                      />
                      {/* 단위 */}
                      <span className="w-6 text-[10px] font-mono text-slate-400 shrink-0 text-right">{f.unit}</span>
                    </div>
                    {/* 부가 설명 (chamfer 같이 의미가 모호한 필드용) */}
                    {f.hint && (
                      <p className="text-[10px] text-slate-400 ml-3.5 leading-snug truncate">
                        {f.hint}
                      </p>
                    )}
                  </label>
                  {/* 인라인 오류 메시지 */}
                  {isInvalid && (
                    <p className="text-[10px] text-rose-500 font-medium mt-0.5 ml-4 leading-snug">
                      {fieldErr}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* 제출 오류 */}
          {error && (
            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[10px]">
              <AlertCircle size={11} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* 액션 버튼 */}
          <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-100">
            <button
              type="button"
              onClick={handleReset}
              disabled={submitting || disabled}
              className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              되돌리기
            </button>
            <button
              type="button"
              onClick={handleRebuild}
              disabled={submitting || disabled || hasErrors}
              title={hasErrors ? '설계값 오류를 먼저 수정하세요.' : '편집한 파라미터로 모델을 다시 만듭니다.'}
              className="flex-[2] flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-bold shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitting
                ? <><Loader2 size={11} className="animate-spin" /> 요청 중...</>
                : hasErrors
                ? <><AlertTriangle size={11} /> 오류 수정 필요</>
                : <><RefreshCw size={11} /> 모델 재구축</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
