/// <summary>
/// App Settings — 외부 앱 등록·수정 창.
///
/// 외부 개발자가 만든 웹앱의 IP·Port 와 카드 정보(이름·분류·그림·설명)를 넣고 [등록]하면
/// 곧바로 카탈로그 카드와 실행 입구(/external-apps/<주소 이름> → IP:Port/<사번>)가 생긴다.
/// 서비스 상태·점검 안내는 다른 App 처럼 [설정] 창에서 바꾼다.
/// </summary>
import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, ChevronDown, Copy, Loader2, PlugZap, Save, Trash2, XCircle } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { ART_LABELS, CardArtPicker, CategorySelect } from './CardMetaFields';
import {
  createRegisteredApp,
  deleteRegisteredApp,
  probeExternalApp,
  updateRegisteredApp,
} from '../../api/appSettings';
import { refreshAppSettings } from '../../hooks/useAppSettings';
import { useToast } from '../../contexts/ToastContext';
import { CATEGORY_ART } from '../../utils/cardArt';
import { suggestSlug, validateRegisteredAppForm } from '../../utils/externalEndpoint';
import { buildDeveloperNotes, developerNotesText } from '../../utils/externalAppDeveloperNotes';

const MODE_OPTIONS = [
  { value: 'Interactive', label: 'Interactive Apps' },
  { value: 'File', label: 'File-Based Apps' },
  { value: 'Parametric', label: 'Parametric Apps' },
  { value: 'Productivity', label: 'Productivity Apps' },
];

const STATUS_OPTIONS = [
  { value: 'Active', label: '서비스 중' },
  { value: 'Developing', label: '개발 중(관리자만)' },
  { value: 'Planned', label: '출시 예정(관리자만)' },
];

const MAX_TAGS = 12;

const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200';
const monoInputCls = `${inputCls} font-mono`;

function Field({ label, hint, error, children }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-bold text-slate-600">
        {label}
        {hint && <span className="ml-1 font-normal text-slate-500">{hint}</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-[11px] font-bold text-red-600">{error}</p>}
    </div>
  );
}

function buildForm(registration) {
  return {
    title: registration?.title ?? '',
    slug: registration?.slug ?? '',
    description: registration?.description ?? '',
    mode: registration?.mode ?? 'Interactive',
    category: registration?.category ?? '',
    art: registration?.art ?? '',
    tags: (registration?.tags ?? []).join(', '),
    contributor: registration?.contributor ?? '',
    devStatus: registration?.dev_status ?? 'Active',
    host: registration?.host ?? '',
    port: registration?.port != null ? String(registration.port) : '',
  };
}

/**
 * @param {object|null} registration  수정할 등록 정보(관리자 목록 항목). null 이면 새로 등록.
 * @param {string[]}    categories    고를 수 있는 기존 분류(카탈로그에서 모음)
 * @param {Set<string>} existingTitles 이미 있는 App 이름(코드 앱 + 등록 앱)
 */
export default function RegisteredAppEditorModal({
  isOpen, onClose, registration, categories = [], existingTitles = new Set(), onSaved,
}) {
  const { showToast } = useToast();
  const isCreate = !registration;
  const [form, setForm] = useState(() => buildForm(registration));
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [probe, setProbe] = useState(null); // { state: 'checking'|'ok'|'fail', message }
  const [notesOpen, setNotesOpen] = useState(false);
  // 폼을 다시 채울 때마다 올린다 — 분류 칸이 새 값으로 '직접 입력' 여부를 다시 정하게.
  const [formVersion, setFormVersion] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const next = buildForm(registration);
    setForm(next);
    setFormVersion(v => v + 1);
    setSlugTouched(Boolean(registration));
    setSubmitted(false);
    setProbe(null);
    // categories 는 목록이 바뀔 때마다 새 배열이라 의존성에서 뺀다(열 때 한 번만 맞춘다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, registration]);

  const patch = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const onTitleChange = (value) => {
    setForm(prev => ({
      ...prev,
      title: value,
      // 주소 이름을 직접 고치기 전까지는 이름을 따라 만든다.
      slug: isCreate && !slugTouched ? suggestSlug(value) : prev.slug,
    }));
  };

  const errors = useMemo(
    () => validateRegisteredAppForm(form, { isCreate, existingTitles }),
    [form, isCreate, existingTitles],
  );
  const hasErrors = Object.keys(errors).length > 0;
  const shown = (key) => (submitted || key === 'endpoint' ? errors[key] : null);

  const parsedTags = form.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, MAX_TAGS);
  const categoryArt = CATEGORY_ART[form.category.trim()] || null;

  const noteInput = {
    title: form.title,
    slug: form.slug.trim(),
    host: errors.endpoint ? '' : form.host.trim(),
    port: errors.endpoint ? '' : form.port,
  };
  const developerNotes = buildDeveloperNotes(noteInput);

  const copyDeveloperNotes = async () => {
    try {
      await navigator.clipboard.writeText(developerNotesText(noteInput));
      showToast('외부 개발자 안내를 복사했습니다. 메신저·메일에 붙여 넣으세요.', 'success');
    } catch {
      showToast('복사하지 못했습니다. 안내 글을 직접 선택해 복사하세요.', 'error');
    }
  };

  const runProbe = async () => {
    if (errors.endpoint) return;
    setProbe({ state: 'checking', message: '확인 중…' });
    try {
      const { data } = await probeExternalApp(form.host.trim(), Number(form.port));
      setProbe({ state: data.ok ? 'ok' : 'fail', message: `${data.url} — ${data.message}` });
    } catch (err) {
      setProbe({ state: 'fail', message: err?.response?.data?.detail || '연결 확인에 실패했습니다.' });
    }
  };

  const handleSave = async () => {
    setSubmitted(true);
    if (hasErrors || saving) return;
    const common = {
      description: form.description.trim() || null,
      mode: form.mode,
      category: form.category.trim(),
      art: form.art || null,
      tags: parsedTags,
      contributor: form.contributor.trim() || null,
      host: form.host.trim(),
      port: Number(form.port),
    };
    setSaving(true);
    try {
      if (isCreate) {
        await createRegisteredApp({
          ...common,
          title: form.title.trim(),
          slug: form.slug.trim(),
          dev_status: form.devStatus,
        });
      } else {
        await updateRegisteredApp(registration.slug, common);
      }
      await refreshAppSettings();
      showToast(
        isCreate ? `'${form.title.trim()}' 를 등록했습니다. 카탈로그에 바로 나타납니다.` : `'${form.title}' 등록 정보를 저장했습니다.`,
        'success',
      );
      await onSaved?.();
      onClose?.();
    } catch (err) {
      showToast(err?.response?.data?.detail || '저장에 실패했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isCreate || deleting) return;
    const ok = window.confirm(
      `'${registration.title}' 를 삭제할까요?\n카드와 실행 입구, 이 App 의 App Settings 설정이 함께 사라집니다. 외부 앱 서버는 그대로입니다.`,
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteRegisteredApp(registration.slug);
      await refreshAppSettings();
      showToast(`'${registration.title}' 를 삭제했습니다.`, 'success');
      await onSaved?.();
      onClose?.();
    } catch (err) {
      showToast(err?.response?.data?.detail || '삭제에 실패했습니다.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? '외부 App 등록' : '외부 App 등록 정보'}
      size="lg"
      footer={(
        <div className="flex items-center gap-2">
          {!isCreate && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 cursor-pointer"
            >
              <Trash2 size={13} />
              {deleting ? '삭제 중…' : '삭제'}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="md" onClick={onClose} className="cursor-pointer">취소</Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleSave}
              disabled={saving || (submitted && hasErrors)}
              className="cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                <Save size={14} />
                {saving ? '저장 중…' : isCreate ? '등록' : '저장'}
              </span>
            </Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-6 p-6">
        {/* 외부 개발자 안내 — 실측으로 확인한 연결 조건. 입력한 IP·Port·주소 이름이 들어간다. */}
        <section className="rounded-xl border border-indigo-200 bg-indigo-50/60">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <button
              type="button"
              onClick={() => setNotesOpen(open => !open)}
              aria-expanded={notesOpen}
              className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
            >
              <BookOpen size={14} className="shrink-0 text-indigo-600" />
              <span className="min-w-0">
                <span className="block text-xs font-bold text-indigo-900">외부 개발자에게 알려줄 사항</span>
                <span className="block text-[11px] text-indigo-800/80">
                  /&lt;사번&gt; 주소 · 요청당 30초 · 업로드 25MB · WebSocket·새 창 불가 · 직접 접속 차단
                </span>
              </span>
              <ChevronDown
                size={14}
                className={`ml-auto shrink-0 text-indigo-600 transition-transform ${notesOpen ? 'rotate-180' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={copyDeveloperNotes}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 transition-colors hover:bg-indigo-50 cursor-pointer"
            >
              <Copy size={12} />
              안내 복사
            </button>
          </div>
          {notesOpen && (
            <div className="max-h-72 space-y-3 overflow-y-auto border-t border-indigo-200 bg-white px-4 py-3">
              {developerNotes.map((section, index) => (
                <div key={section.heading}>
                  <p className="text-[11px] font-bold text-slate-700">{index + 1}. {section.heading}</p>
                  <ul className="mt-1 space-y-1">
                    {section.items.map(item => (
                      <li key={item} className="flex gap-1.5 text-[11px] leading-relaxed text-slate-600">
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className="break-keep [overflow-wrap:anywhere]">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="text-[11px] text-slate-500">
                IP·Port·주소 이름을 입력하면 안내 글에 그 값이 들어갑니다. [안내 복사]로 메신저·메일에 붙여 넣으세요.
              </p>
            </div>
          )}
        </section>

        {/* 이름·주소 */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="App 이름" hint={isCreate ? '(카드 제목, 등록 후 변경 불가)' : '(변경 불가)'} error={shown('title')}>
            <input
              type="text"
              value={form.title}
              onChange={(e) => onTitleChange(e.target.value)}
              disabled={!isCreate}
              maxLength={200}
              autoFocus={isCreate}
              placeholder="예) Block Lug Planner"
              className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-500`}
            />
          </Field>
          <Field label="주소 이름" hint={isCreate ? '(영문 소문자·숫자·-, 변경 불가)' : '(변경 불가)'} error={shown('slug')}>
            <input
              type="text"
              value={form.slug}
              onChange={(e) => { setSlugTouched(true); patch('slug', e.target.value.toLowerCase()); }}
              disabled={!isCreate}
              maxLength={40}
              spellCheck={false}
              placeholder="block-lug"
              className={`${monoInputCls} disabled:bg-slate-50 disabled:text-slate-500`}
            />
          </Field>
        </section>

        <Field label="설명">
          <textarea
            rows={2}
            value={form.description}
            onChange={(e) => patch('description', e.target.value)}
            maxLength={1000}
            placeholder="카드와 실행 화면에 보이는 한 줄 설명"
            className={`${inputCls} resize-none`}
          />
        </Field>

        {/* 분류 */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="표시할 목록">
            <select value={form.mode} onChange={(e) => patch('mode', e.target.value)} className={inputCls}>
              {MODE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </Field>
          <Field label="분류" error={shown('category')}>
            {/* 창을 열 때마다 직접 입력 여부를 처음 값으로 다시 정한다. */}
            <CategorySelect
              key={formVersion}
              value={form.category}
              onChange={(value) => patch('category', value)}
              categories={categories}
            />
          </Field>
        </section>

        {/* 카드 그림 */}
        <section>
          <h4 className="mb-2 text-[11px] font-bold text-slate-600">
            카드 그림
            <span className="ml-1 font-normal text-slate-500">
              (분류 기본을 고르면 분류에 맞는 그림{categoryArt ? ` — ${ART_LABELS[categoryArt]}` : ' — 없음'})
            </span>
          </h4>
          <CardArtPicker
            value={form.art}
            onChange={(name) => patch('art', name)}
            defaultArt={categoryArt}
            defaultLabel="분류 기본"
          />
        </section>

        {/* 접속 주소 */}
        <section className="space-y-2">
          <h4 className="text-[11px] font-bold text-slate-600">접속 주소</h4>
          <div className="grid grid-cols-[1fr_7rem_auto] items-start gap-2">
            <input
              type="text"
              value={form.host}
              onChange={(e) => { patch('host', e.target.value); setProbe(null); }}
              maxLength={15}
              spellCheck={false}
              aria-label="IP"
              placeholder="IP  예) 10.14.42.145"
              className={monoInputCls}
            />
            <input
              type="text"
              inputMode="numeric"
              value={form.port}
              onChange={(e) => { patch('port', e.target.value.replace(/[^0-9]/g, '')); setProbe(null); }}
              maxLength={5}
              aria-label="Port"
              placeholder="Port"
              className={monoInputCls}
            />
            <button
              type="button"
              onClick={runProbe}
              disabled={Boolean(errors.endpoint) || probe?.state === 'checking'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            >
              {probe?.state === 'checking' ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
              연결 확인
            </button>
          </div>
          {form.host || form.port ? (
            errors.endpoint ? (
              <p className="text-[11px] font-bold text-red-600">{errors.endpoint}</p>
            ) : (
              <p className="text-[11px] text-slate-500">
                사용자는 <span className="font-mono">{`http://${form.host.trim()}:${form.port}/<사번>`}</span>(으)로 연결됩니다
                {form.slug && <> (WorkBench 입구 <span className="font-mono">/external-apps/{form.slug}</span>)</>}.
              </p>
            )
          ) : null}
          {probe && probe.state !== 'checking' && (
            <p className={`flex items-center gap-1.5 text-[11px] font-bold ${probe.state === 'ok' ? 'text-emerald-700' : 'text-amber-700'}`}>
              {probe.state === 'ok' ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
              {probe.message}
              {probe.state !== 'ok' && <span className="font-normal text-slate-500">— 서버가 아직 안 떠 있어도 등록은 됩니다.</span>}
            </p>
          )}
        </section>

        {/* 기타 */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="담당자">
            <input
              type="text"
              value={form.contributor}
              onChange={(e) => patch('contributor', e.target.value)}
              maxLength={100}
              className={inputCls}
            />
          </Field>
          <Field label="태그" hint="(쉼표로 구분)">
            <input
              type="text"
              value={form.tags}
              onChange={(e) => patch('tags', e.target.value)}
              placeholder="Lug, 권상"
              className={inputCls}
            />
          </Field>
          {isCreate ? (
            <Field label="처음 상태">
              <select value={form.devStatus} onChange={(e) => patch('devStatus', e.target.value)} className={inputCls}>
                {STATUS_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="self-end pb-2 text-[11px] text-slate-500">
              서비스 상태·점검은 목록의 [설정]에서 바꿉니다.
            </div>
          )}
        </section>

      </div>
    </Modal>
  );
}
