import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ClipboardList, Copy, FileText, Gauge, Info,
  Loader2, Package, RotateCcw, ShieldCheck, Split,
} from 'lucide-react';

import { Badge, Button, Input, Modal } from '../ui';
import ModelSourceInsights from './ModelSourceInsights';
import { QualityBadge, QualityHelp } from './QualityLevelGuide';
import {
  previewModelRegistration,
  registerModel,
  restoreRegisteredModel,
} from '../../api/modelRegistry';
import {
  ARTIFACT_KIND_LABELS,
  CONFIDENCE_LEVELS,
  MODEL_ROLES,
  STORED_KIND_LABELS,
  VISIBILITY_OPTIONS,
  buildRegistrationPayload,
  defaultSelectedArtifactKinds,
  extractApiError,
  formatBytes,
  formatNumber,
  formatUtilization,
  outcomeInfo,
  qualityInfo,
} from '../../utils/modelRegistryUtils';

const SELECT_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 ' +
  'transition-colors hover:border-slate-400 ' +
  'focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20';

/**
 * BDF 등록 모달 — preview 와 commit 을 명확히 분리한다.
 *
 * 모달을 여는 것만으로는 아무것도 등록되지 않는다. 열릴 때 preview 를 호출해
 * (서버 상태 변경 없이) 자동 추출 정보를 보여주고, 사용자가 '등록'을 눌러야 commit 한다.
 *
 * 레이아웃: 좁은 모달에 모든 것을 세로로 쌓으면 스크롤만 길어지고 내용이 잘려 보였다.
 * 이제 size="screen" 위에 **3열**로 펼친다 — 왼쪽은 '서버가 확인한 사실'(읽기 전용),
 * 가운데는 '서버가 계산한 두 축', 오른쪽은 '사람이 채우는 큐레이션'.
 * 사실 → 판단 → 입력 순으로 읽히고, 제출 버튼이 있는 오른쪽 아래에서 흐름이 끝난다.
 *
 * @param {boolean}  isOpen
 * @param {() => void} onClose
 * @param {{ analysisId:number, artifactKind:string, label?:string }} source
 * @param {(result) => void} [onRegistered] - 등록/복원 성공 후 콜백.
 *   복원(archive 해제)으로 끝난 경우 payload 에 `restored: true` 가 붙는다 —
 *   부모가 '등록되었습니다' 대신 '복원되었습니다' 로 알릴 수 있게 하기 위함이다.
 */
export default function ModelRegistrationModal({ isOpen, onClose, source, onRegistered }) {
  const [phase, setPhase] = useState('idle');      // idle | previewing | ready | submitting | done
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const [form, setForm] = useState({
    title: '',
    description: '',
    modelType: '',
    modelRole: 'reference',
    confidence: 'medium',
    reuseNotes: '',
    visibility: 'company',
    tags: '',
  });
  const [selectedKinds, setSelectedKinds] = useState([]);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  /**
   * preview 요청 세대 번호.
   *
   * preview 중에도 모달을 닫을 수 있게 되면서, 이미 닫힌(또는 다시 연) 모달에
   * **늦게 도착한 응답이 상태를 덮어쓰는** 경로가 생겼다. 요청마다 번호를 매기고
   * 최신 번호가 아니면 결과를 버린다.
   */
  const previewSeq = useRef(0);

  const runPreview = useCallback(async () => {
    if (!source?.analysisId || !source?.artifactKind) return;
    const seq = previewSeq.current + 1;
    previewSeq.current = seq;
    setPhase('previewing');
    setError(null);
    try {
      const res = await previewModelRegistration(source.analysisId, source.artifactKind);
      if (seq !== previewSeq.current) return;   // 닫혔거나 새 preview 가 시작됨
      const data = res.data;
      setPreview(data);
      setSelectedKinds(defaultSelectedArtifactKinds(data.available_artifacts));
      setForm((f) => ({
        ...f,
        title: f.title || suggestTitle(data),
      }));
      setPhase('ready');
    } catch (e) {
      if (seq !== previewSeq.current) return;
      setError(extractApiError(e, '미리보기를 불러오지 못했습니다.'));
      setPhase('idle');
    }
  }, [source?.analysisId, source?.artifactKind]);

  // 모달이 열릴 때만 preview 한다. 닫히면 상태를 초기화해 다음 등록에 섞이지 않게 한다.
  useEffect(() => {
    if (!isOpen) {
      previewSeq.current += 1;   // 진행 중인 preview 응답을 무효화한다
      setPhase('idle');
      setPreview(null);
      setError(null);
      setResult(null);
      setSelectedKinds([]);
      setForm({
        title: '', description: '', modelType: '', modelRole: 'reference',
        confidence: 'medium', reuseNotes: '', visibility: 'company', tags: '',
      });
      return;
    }
    runPreview();
  }, [isOpen, runPreview]);

  const toggleKind = (kind) => {
    setSelectedKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      setError({ code: null, message: '제목을 입력하세요.' });
      return;
    }
    setPhase('submitting');
    setError(null);
    try {
      const payload = buildRegistrationPayload({
        sourceAnalysisId: source.analysisId,
        artifactKind: source.artifactKind,
        title: form.title,
        description: form.description,
        modelType: form.modelType,
        modelRole: form.modelRole,
        confidence: form.confidence,
        reuseNotes: form.reuseNotes,
        visibility: form.visibility,
        tags: form.tags,
        includeArtifacts: selectedKinds,
      });
      const res = await registerModel(payload);
      setResult(res.data);
      setPhase('done');
      onRegistered?.(res.data);
    } catch (e) {
      setError(extractApiError(e, '등록에 실패했습니다.'));
      setPhase('ready');
    }
  };

  /**
   * 보관된 동일 BDF 를 되살린다.
   *
   * 같은 BDF 는 sha256 이 전역 unique 라 '다시 등록'이 원천적으로 불가능하다.
   * 보관된 모델을 다시 쓰는 유일한 길이 복원이므로, 막다른 409 대신 여기서 빠져나간다.
   * 기존 제목·태그는 건드리지 않는다 — 예전 큐레이션 내용을 덮어쓰면 안 되기 때문이다.
   */
  const handleRestore = async (modelUid) => {
    if (!modelUid) return;
    setPhase('submitting');
    setError(null);
    try {
      const res = await restoreRegisteredModel(modelUid);
      setResult({
        model_uid: res.data.model_uid,
        revision: res.data.revisions?.[0]?.revision_no ?? null,
        quality_level: res.data.revisions?.[0]?.quality_level ?? null,
        restored: true,
      });
      setPhase('done');
      // 부모가 '등록'과 '복원'의 토스트를 구분할 수 있도록 표식을 붙인다.
      onRegistered?.({ ...res.data, restored: true });
    } catch (e) {
      setError(extractApiError(e, '복원하지 못했습니다.'));
      setPhase('ready');
    }
  };

  const summary = preview?.summary;
  const duplicate = preview?.duplicate;
  const archivedDuplicate = duplicate?.status === 'archived';

  /**
   * 닫기를 막아야 하는 구간은 commit(submitting) 뿐이다.
   *
   * preview 는 서버 상태를 전혀 바꾸지 않는 읽기 전용 단계인데, BDF 파싱에 최대 180초가
   * 걸릴 수 있다. 그동안 ESC·오버레이·X 를 전부 막으면 사용자가 모달에 갇힌다.
   */
  const blockClose = phase === 'submitting';

  const artifacts = preview?.available_artifacts ?? [];
  const allSelected = artifacts.length > 0 && artifacts.every((a) => selectedKinds.includes(a.kind));

  return (
    <Modal
      isOpen={isOpen}
      onClose={blockClose ? () => {} : onClose}
      title="Model Library 에 등록"
      size="screen"
      footer={
        phase === 'done' ? (
          <div className="flex justify-end">
            <Button onClick={onClose}>닫기</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* preview/commit 분리를 상시 노출한다 — 사용자가 '이미 저장됐나?' 를 의심하지 않게. */}
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Info size={13} className="shrink-0 text-slate-400" />
              「등록」을 누르기 전까지, 이 단계에서는 아무것도 저장되지 않습니다.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} disabled={blockClose}>취소</Button>
              {/* 중복이 확인된 상태에서 '등록'은 반드시 409 로 끝난다 — 누르게 두지 않는다. */}
              <Button
                onClick={handleSubmit}
                isLoading={phase === 'submitting'}
                disabled={phase !== 'ready' || Boolean(duplicate)}
              >
                등록
              </Button>
            </div>
          </div>
        )
      }
    >
      {/* ── 분석 중 ── */}
      {phase === 'previewing' && (
        <div className="flex flex-col items-center justify-center px-6 py-20 text-slate-500">
          <Loader2 size={32} className="animate-spin text-brand-blue" />
          <p className="mt-3 text-sm font-semibold text-slate-700">모델을 분석하는 중…</p>
          <p className="mt-1 text-xs">
            큰 BDF 는 몇 분이 걸릴 수 있습니다. 이 단계에서는 아무것도 저장되지 않습니다.
          </p>
          {/* 읽기 전용 단계라 중단해도 잃을 것이 없다는 점을 명시한다. */}
          <p className="mt-2 text-[11px] text-slate-400">
            기다리지 않고 닫아도 됩니다 — 다시 열면 처음부터 분석합니다.
          </p>
        </div>
      )}

      {/* ── 완료 ── */}
      {phase === 'done' && result && (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="rounded-full bg-emerald-50 p-3">
            <CheckCircle2 size={36} className="text-emerald-600" />
          </div>
          <p className="mt-4 text-lg font-bold text-slate-800">
            {result.restored ? '복원했습니다' : '등록되었습니다'}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Badge variant="neutral" size="sm">revision {result.revision ?? '-'}</Badge>
            <QualityBadge level={result.quality_level} />
          </div>
          {result.restored && (
            <p className="mt-3 max-w-md text-xs leading-relaxed text-slate-500">
              기존 제목·태그는 그대로 유지했습니다. 내용 수정은 Model Library 상세에서 하세요.
            </p>
          )}
          <code className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-600">
            {result.model_uid}
          </code>
        </div>
      )}

      {/* ── preview 실패/미실행 (idle) — 본문 전체를 상태 화면으로 ── */}
      {phase === 'idle' && (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <AlertTriangle size={36} className={error ? 'text-red-500' : 'text-slate-300'} />
          <p className={`mt-3 text-sm font-bold ${error ? 'text-red-700' : 'text-slate-600'}`}>
            {error ? error.message : '등록 대상 정보를 확인할 수 없습니다.'}
          </p>
          {!error && (
            <p className="mt-1 text-xs text-slate-500">
              해석 결과 화면에서 다시 시도해 주세요.
            </p>
          )}
          {error && (
            <Button variant="secondary" className="mt-4" onClick={runPreview}>
              다시 시도
            </Button>
          )}
        </div>
      )}

      {/* ── 본 화면 ── */}
      {(phase === 'ready' || phase === 'submitting') && preview && (
        <div className="space-y-4 p-5 lg:p-6">
          {/* 알림 스트립 — 폭 전체를 써서 절대 놓치지 않게 한다 */}
          {error && (
            <Notice tone="error" icon={AlertTriangle} title={error.message}>
              {(error.code === 'EXACT_DUPLICATE' || error.code === 'ARCHIVED_DUPLICATE')
                && error.modelUid && (
                <p className="mt-1 text-xs">
                  기존 등록: <code className="font-mono">{error.modelUid}</code> (revision {error.revision})
                </p>
              )}
              {error.code === 'ARCHIVED_DUPLICATE' && error.modelUid && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => handleRestore(error.modelUid)}
                  isLoading={phase === 'submitting'}
                >
                  <RotateCcw size={13} className="mr-1" /> 삭제 취소하고 복원
                </Button>
              )}
            </Notice>
          )}

          {duplicate && (
            <Notice
              tone={archivedDuplicate ? 'warning' : 'error'}
              icon={Copy}
              title={
                archivedDuplicate
                  ? '이 BDF 는 전에 등록했다가 삭제한 모델입니다.'
                  : '동일한 BDF 가 이미 등록되어 있습니다.'
              }
            >
              <p className="mt-1 text-xs">
                <span className="font-semibold">{duplicate.title}</span> · revision {duplicate.revision}
                {archivedDuplicate
                  ? ' — 삭제해도 파일은 남아 있어 같은 파일을 새로 등록할 수 없습니다. 복원하면 그대로 다시 쓸 수 있습니다.'
                  : ' — 등록을 시도하면 거부됩니다.'}
              </p>
              <p className="mt-1 text-xs opacity-80">아래 「등록」 버튼은 비활성화됩니다.</p>
              {archivedDuplicate && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => handleRestore(duplicate.model_uid)}
                  isLoading={phase === 'submitting'}
                >
                  <RotateCcw size={13} className="mr-1" /> 삭제 취소하고 복원
                </Button>
              )}
            </Notice>
          )}

          {preview.warnings?.length > 0 && (
            <Notice tone="info" icon={Info} title="확인이 필요한 사항">
              <ul className="mt-1 space-y-0.5">
                {preview.warnings.map((w, i) => (
                  <li key={i} className="text-xs leading-relaxed">· {w}</li>
                ))}
              </ul>
            </Notice>
          )}

          {/* ── 3열 작업면: 사실 → 이 모델이 어떻게 만들어졌나 → 사람이 채울 것 ── */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-12">
            {/* 1. 등록 대상 + 자동 판정(두 축) */}
            <div className="space-y-3 xl:col-span-4">
              <ColumnHeading
                icon={FileText}
                title="등록 대상"
                caption="서버가 경로를 직접 확인한 원본입니다. 이 값은 바꿀 수 없습니다."
              />

              <Card tone="muted">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <DataField
                    className="col-span-2"
                    label="파일"
                    value={preview.source.file_name}
                    mono
                  />
                  <DataField
                    label="산출물 종류"
                    value={
                      ARTIFACT_KIND_LABELS[preview.source.artifact_kind]
                      ?? preview.source.artifact_kind
                    }
                  />
                  <DataField label="원 프로그램" value={preview.source.program_name || '-'} />
                  <DataField label="원 해석자" value={preview.source.owner_id ?? '-'} />
                  <DataField label="크기" value={formatBytes(preview.source.size_bytes)} />
                </dl>
              </Card>

              <ColumnHeading
                icon={Gauge}
                title="자동 판정"
                caption="서버가 BDF 를 읽어 계산했습니다. 아래 두 축은 서로 독립입니다."
              />
              {summary ? <AxisPanels summary={summary} /> : (
                <Card>
                  <p className="py-6 text-center text-xs text-slate-500">
                    자동 분석 정보를 얻지 못했습니다.
                  </p>
                </Card>
              )}
            </div>

            {/*
              2. 산출물의 '내용'.
              예전에는 이 자리에 파일 체크박스만 있었다 — 「정규화 모델 JSON」을 저장할지
              말지 고르라고 하면서 그게 무엇인지는 알려 주지 않았다. 이제 값을 먼저 보여 주고,
              보관 여부 선택은 오른쪽 아래로 내렸다.
            */}
            <div className="space-y-3 xl:col-span-4">
              <ColumnHeading
                icon={Package}
                title="이 모델이 만들어진 내역"
                caption="입력 CSV 가 어떻게 모델이 되었는지. 등록하면 이 내용이 함께 보존됩니다."
              />
              <ModelSourceInsights summary={summary} schemaVersion={summary?.schemaVersion} dense />
            </div>

            {/* 3. 사람이 채우는 큐레이션 */}
            <div className="space-y-3 lg:col-span-2 xl:col-span-4">
              <ColumnHeading
                icon={ClipboardList}
                title="등록 정보"
                caption="나중에 이 모델을 찾고 재사용할 때 쓰는 값입니다. 등록 후에도 수정할 수 있습니다."
              />

              <Card className="space-y-3">
                <Input
                  label="제목 *"
                  value={form.title}
                  onChange={setField('title')}
                  placeholder="예: Module Unit 4점 권상 기준 모델"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Labeled label="역할">
                    <select className={SELECT_CLASS} value={form.modelRole} onChange={setField('modelRole')}>
                      {MODEL_ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled label="신뢰도">
                    <select className={SELECT_CLASS} value={form.confidence} onChange={setField('confidence')}>
                      {CONFIDENCE_LEVELS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </Labeled>
                  <Input
                    label="모델 종류"
                    value={form.modelType}
                    onChange={setField('modelType')}
                    placeholder="예: module-unit"
                  />
                  <Labeled label="공개 범위">
                    <select className={SELECT_CLASS} value={form.visibility} onChange={setField('visibility')}>
                      {VISIBILITY_OPTIONS.map((v) => (
                        <option key={v.value} value={v.value}>{v.label}</option>
                      ))}
                    </select>
                  </Labeled>
                </div>
                <Input
                  label="태그 (쉼표로 구분)"
                  value={form.tags}
                  onChange={setField('tags')}
                  placeholder="4-point-lifting, beam-frame"
                />
                <Labeled label="설명">
                  <textarea
                    className={`${SELECT_CLASS} min-h-[76px] resize-y`}
                    value={form.description}
                    onChange={setField('description')}
                    placeholder="이 모델을 남기는 이유"
                  />
                </Labeled>
                <Labeled label="재사용 주의사항">
                  <textarea
                    className={`${SELECT_CLASS} min-h-[64px] resize-y`}
                    value={form.reuseNotes}
                    onChange={setField('reuseNotes')}
                    placeholder="예: COG 편심이 큰 모델에 재사용 시 재검토 필요"
                  />
                </Labeled>
              </Card>

              {/*
                파일 보관 선택 — 기본값이 이미 맞으므로 접어 둔다.
                왼쪽·가운데에서 값을 다 보여 준 뒤라, 여기 목록은 '무엇을 이해할까'가 아니라
                '무엇을 근거로 남길까'의 문제다. 대부분은 손댈 일이 없다.
              */}
              <details className="group rounded-xl border border-slate-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-[13px] font-bold text-slate-700 transition-colors hover:text-brand-blue">
                  <Package size={14} className="shrink-0 text-slate-400" />
                  함께 보관할 원본 파일
                  <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">
                    {selectedKinds.length}/{artifacts.length}
                  </span>
                </summary>
                <div className="border-t border-slate-100 px-4 py-3">
                  <p className="mb-2.5 text-[11px] leading-relaxed text-slate-500">
                    재해석·감사에 쓰는 근거 파일입니다. 위에 보이는 내용은 등록만 하면 저장되므로,
                    이 선택은 <b className="text-slate-600">원본까지 남길지</b>의 문제입니다.
                  </p>
                  {artifacts.length === 0 ? (
                    <p className="py-2 text-center text-xs text-slate-500">
                      추가로 보관할 파일이 없습니다.
                    </p>
                  ) : (
                    <>
                      <div className="mb-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedKinds(allSelected ? [] : artifacts.map((a) => a.kind))
                          }
                          className="cursor-pointer text-[11px] font-semibold text-brand-blue hover:underline"
                        >
                          {allSelected ? '모두 해제' : '모두 선택'}
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {artifacts.map((a) => {
                          const checked = selectedKinds.includes(a.kind);
                          return (
                            <label
                              key={a.kind}
                              className={[
                                'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors',
                                checked
                                  ? 'border-brand-blue/40 bg-brand-blue/5'
                                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                              ].join(' ')}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleKind(a.kind)}
                                className="h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-brand-blue focus:ring-brand-blue/30"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium text-slate-700">
                                  {STORED_KIND_LABELS[a.kind] ?? a.kind}
                                </span>
                                {a.file_name && (
                                  <span className="block truncate font-mono text-[10px] text-slate-500">
                                    {a.file_name}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                                {formatBytes(a.size_bytes)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
                    「정규화 모델 JSON」을 빼면 <b className="text-slate-600">3D 미리보기</b>를 만들 수 없습니다.
                    F06/OP2 는 용량이 커 기본 제외됩니다.
                  </p>
                </div>
              </details>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * 품질(모델이 얼마나 검증됐나)과 설계 결과(통과했나)를 **위아래로 떼어 놓는다.**
 *
 * 나란히 붙여 두면 "품질이 좋아서 통과했다"는 인과로 읽힌다. 둘은 독립된 축이고,
 * 응력이 초과된(미통과) 모델도 정확히 표현됐다면 좋은 회귀 예제다.
 */
function AxisPanels({ summary }) {
  const quality = summary.modelQuality ?? {};
  const outcome = summary.analysisOutcome ?? {};
  const geometry = summary.geometry ?? {};
  const q = qualityInfo(quality.qualityLevel);
  const o = outcomeInfo(outcome.outcome);

  return (
    <>
      <Card>
        <CardHeader
          icon={ShieldCheck}
          title="모델 품질"
          right={<QualityBadge level={quality.qualityLevel} />}
        />
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          {q.description || '모델이 얼마나 검증되었는지를 나타냅니다.'}
        </p>
        <dl className="mt-2.5">
          <MetricRow label="노드" value={geometry.nodeCount} />
          <MetricRow label="요소" value={geometry.elementCount} />
          <MetricRow label="미참조 GRID" value={quality.orphanNodeCount} defect />
          <MetricRow label="고립 GRID" value={quality.isolatedNodeCount} defect />
          <MetricRow label="영길이 요소" value={quality.zeroLengthElementCount} defect />
          <MetricRow label="분리 그룹" value={quality.disconnectedGroupCount} defect />
        </dl>
        {/* 등급 이름만으로는 '왜 이 등급인지'를 모른다 — 도달 조건을 접어서 함께 둔다 */}
        <div className="mt-2.5">
          <QualityHelp current={quality.qualityLevel} />
        </div>
      </Card>

      {/* 두 축 사이의 명시적 분리선 — 붙여 놓으면 인과처럼 읽힌다 */}
      <div className="flex items-center gap-2" aria-hidden="true">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
          <Split size={12} /> 서로 독립된 축
        </span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <Card>
        <CardHeader
          icon={Gauge}
          title="설계 결과"
          right={<Badge variant={o.variant} size="sm">{o.label}</Badge>}
        />
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          해석 결과는 모델 품질과 별개입니다. 미통과 모델도 회귀 예제로 가치가 있습니다.
        </p>
        <dl className="mt-2.5">
          <MetricRow
            label="최대 응력"
            value={outcome.maxStressMPa}
            format={(v) => formatNumber(v, { digits: 1, suffix: ' MPa' })}
          />
          <MetricRow
            label="허용 응력"
            value={outcome.allowableStressMPa}
            format={(v) => formatNumber(v, { digits: 1, suffix: ' MPa' })}
          />
          <MetricRow label="사용률" value={outcome.maxUtilization} format={formatUtilization} />
          <MetricRow label="초과 부재" value={outcome.memberExceedCount} defect />
        </dl>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 표시용 소형 컴포넌트                                                 */
/* ------------------------------------------------------------------ */

const CARD_TONES = {
  plain: 'border-slate-200 bg-white',
  muted: 'border-slate-200 bg-slate-50',
};

function Card({ children, tone = 'plain', className = '' }) {
  return (
    <section className={`rounded-xl border p-4 ${CARD_TONES[tone]} ${className}`}>
      {children}
    </section>
  );
}

function CardHeader({ icon: Icon, title, right }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h4 className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
        {Icon && <Icon size={14} className="shrink-0 text-slate-400" />}
        {title}
      </h4>
      {right}
    </div>
  );
}

/** 열 제목 — 카드 밖에 두어 '이 열이 무엇인지' 를 먼저 읽게 한다. */
function ColumnHeading({ icon: Icon, title, caption }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 rounded-lg bg-slate-100 p-1.5 text-slate-500" aria-hidden="true">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{caption}</p>
      </div>
    </div>
  );
}

const NOTICE_TONES = {
  error: 'border-red-200 bg-red-50 text-red-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
};

function Notice({ tone = 'info', icon: Icon, title, children }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border p-3.5 ${NOTICE_TONES[tone]}`}>
      {Icon && <Icon size={16} className="mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{title}</p>
        {children}
      </div>
    </div>
  );
}

function DataField({ label, value, mono = false, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
      <dd
        className={`mt-0.5 truncate font-medium text-slate-800 ${mono ? 'font-mono text-xs' : 'text-sm'}`}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * 지표 한 줄.
 *
 * `defect` 는 '0 이 정상' 인 결함 카운트다. 값이 있고 0 보다 크면 색으로 눈에 띄게 하되,
 * 값이 없을 때(null)는 '-' 로 두고 절대 0 처럼 보이게 하지 않는다.
 */
function MetricRow({ label, value, format = formatNumber, defect = false }) {
  const missing = value === null || value === undefined || Number.isNaN(value);
  const flagged = defect && !missing && Number(value) > 0;

  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd
        className={[
          'text-xs tabular-nums',
          missing ? 'text-slate-400' : flagged ? 'font-bold text-amber-600' : 'font-semibold text-slate-800',
        ].join(' ')}
      >
        {missing ? '-' : format(value)}
      </dd>
    </div>
  );
}

function Labeled({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-600 select-none">{label}</label>
      {children}
    </div>
  );
}

/** preview 결과로 제목 초안을 만든다. 사용자가 언제든 바꿀 수 있다. */
function suggestTitle(previewData) {
  const base = previewData?.source?.file_name?.replace(/\.bdf$/i, '') ?? '';
  const kind = ARTIFACT_KIND_LABELS[previewData?.source?.artifact_kind];
  return kind ? `${base} — ${kind}` : base;
}
