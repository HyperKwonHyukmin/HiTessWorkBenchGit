/// <summary>
/// App별 관리자 설정 모달입니다.
///
/// 서비스 상태(Active/Developing/Planned), 점검 모드와 안내 문구, 그리고 표시
/// 메타데이터(설명·태그·담당자)를 편집합니다. 저장하면 백엔드에 '오버라이드'로
/// 남고, [기본값으로 초기화]는 그 오버라이드를 지워 코드 값으로 되돌립니다.
/// </summary>
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Hammer, RotateCcw, Save, Wrench } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { resetAppSetting, updateAppSetting } from '../../api/appSettings';
import { refreshAppSettings } from '../../hooks/useAppSettings';
import { useToast } from '../../contexts/ToastContext';

const DEV_STATUS_OPTIONS = [
  {
    value: 'Active',
    label: '서비스 중',
    hint: '모든 사용자가 사용할 수 있습니다.',
    active: 'border-emerald-500 bg-emerald-50 text-emerald-700',
  },
  {
    value: 'Developing',
    label: '개발 중',
    hint: '관리자만 진입할 수 있습니다.',
    active: 'border-blue-500 bg-blue-50 text-blue-700',
  },
  {
    value: 'Planned',
    label: '출시 예정',
    hint: '관리자만 진입할 수 있습니다.',
    active: 'border-slate-500 bg-slate-100 text-slate-700',
  },
];

const MAX_TAGS = 12;

/** 편집 폼의 초기 상태를 만든다. 오버라이드가 없으면 코드 기본값을 보여준다. */
function buildInitialForm(app, setting) {
  return {
    devStatus: setting?.dev_status || app?.devStatus || 'Active',
    maintenance: Boolean(setting?.maintenance),
    maintenanceMessage: setting?.maintenance_message || '',
    description: setting?.description ?? app?.description ?? '',
    tags: (setting?.tags?.length ? setting.tags : app?.tags || []).join(', '),
    contributor: setting?.contributor ?? app?.contributor ?? '',
  };
}

/**
 * @param {object}   app      실효 앱 메타(useAppCatalogue 기준)
 * @param {object}   setting  현재 서버 오버라이드 (없으면 undefined)
 * @param {Function} onSaved  저장/초기화 후 호출 — 목록 갱신용
 */
export default function AppSettingsModal({ isOpen, onClose, app, setting, onSaved }) {
  const { showToast } = useToast();
  const [form, setForm] = useState(() => buildInitialForm(app, setting));
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  // 다른 앱을 열었거나 서버 값이 갱신되면 폼을 다시 채운다.
  useEffect(() => {
    if (isOpen) setForm(buildInitialForm(app, setting));
  }, [isOpen, app, setting]);

  const hasOverride = Boolean(setting);
  const patch = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const parsedTags = useMemo(
    () => form.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, MAX_TAGS),
    [form.tags],
  );

  // 사용자에게 실제로 어떻게 보일지 미리 알려 준다.
  const blockPreview = useMemo(() => {
    if (form.maintenance) {
      return {
        tone: 'amber',
        text: '일반 사용자는 진입할 수 없고, 아래 안내 문구를 보게 됩니다.',
      };
    }
    if (form.devStatus === 'Developing' || form.devStatus === 'Planned') {
      return { tone: 'blue', text: '일반 사용자는 진입할 수 없고 관리자만 사용할 수 있습니다.' };
    }
    return null;
  }, [form.maintenance, form.devStatus]);

  const handleSave = async () => {
    if (!app?.title || saving) return;
    setSaving(true);
    try {
      await updateAppSetting(app.title, {
        dev_status: form.devStatus,
        maintenance: form.maintenance,
        // 빈 문자열은 서버에서 null(오버라이드 해제)로 접힌다.
        maintenance_message: form.maintenanceMessage.trim() || null,
        description: form.description.trim() || null,
        tags: parsedTags,
        contributor: form.contributor.trim() || null,
      });
      await refreshAppSettings();
      showToast(`'${app.title}' 설정을 저장했습니다.`, 'success');
      onSaved?.();
      onClose?.();
    } catch (err) {
      showToast(err?.response?.data?.detail || '설정 저장에 실패했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!app?.title || resetting) return;
    setResetting(true);
    try {
      await resetAppSetting(app.title);
      await refreshAppSettings();
      showToast(`'${app.title}' 설정을 기본값으로 되돌렸습니다.`, 'success');
      onSaved?.();
      onClose?.();
    } catch (err) {
      showToast(err?.response?.data?.detail || '초기화에 실패했습니다.', 'error');
    } finally {
      setResetting(false);
    }
  };

  if (!app) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="App 설정"
      size="lg"
      footer={(
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={!hasOverride || resetting || saving}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            title={hasOverride ? '이 App의 오버라이드를 지우고 코드 기본값으로 되돌립니다.' : '변경된 설정이 없습니다.'}
          >
            <RotateCcw size={13} />
            기본값으로 초기화
          </button>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="md" onClick={onClose} className="cursor-pointer">
              취소
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleSave}
              disabled={saving}
              className="cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                <Save size={14} />
                {saving ? '저장 중…' : '저장'}
              </span>
            </Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-6 p-6">
        {/* 대상 앱 */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">설정 대상</p>
          <p className="mt-0.5 text-sm font-bold text-slate-800">{app.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {app.mode} · {app.category}
            {hasOverride && (
              <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                관리자 설정 적용됨
              </span>
            )}
          </p>
        </div>

        {/* 서비스 상태 */}
        <section>
          <h4 className="mb-2 text-xs font-bold text-slate-700">서비스 상태</h4>
          <div className="grid grid-cols-3 gap-2">
            {DEV_STATUS_OPTIONS.map(option => {
              const selected = form.devStatus === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => patch('devStatus', option.value)}
                  className={`rounded-xl border-2 px-3 py-2.5 text-left transition-colors cursor-pointer ${
                    selected ? option.active : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <span className="block text-sm font-bold">{option.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug opacity-80">{option.hint}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 점검 모드 */}
        <section>
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
            <button
              type="button"
              role="switch"
              aria-checked={form.maintenance}
              onClick={() => patch('maintenance', !form.maintenance)}
              className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors cursor-pointer ${
                form.maintenance ? 'bg-amber-500' : 'bg-slate-300'
              }`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  form.maintenance ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                <Hammer size={14} className="text-amber-500" />
                점검 모드
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                서비스 상태와 별개로 App을 일시 중단합니다. 서버 점검·긴급 버그 대응처럼
                금방 되돌릴 상황에 쓰세요.
              </p>

              {form.maintenance && (
                <div className="mt-3">
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">
                    사용자에게 보여줄 안내 문구
                  </label>
                  <textarea
                    rows={2}
                    value={form.maintenanceMessage}
                    onChange={(e) => patch('maintenanceMessage', e.target.value)}
                    maxLength={500}
                    placeholder="예) 서버 점검 중입니다. 오늘 16:00 이후 다시 시도해주세요."
                    className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    비워 두면 기본 문구("현재 점검 중입니다…")가 표시됩니다.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 차단 결과 미리보기 */}
        {blockPreview && (
          <div
            className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-xs ${
              blockPreview.tone === 'amber'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-blue-200 bg-blue-50 text-blue-800'
            }`}
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              {blockPreview.text}
              <br />
              <span className="opacity-75">
                화면 진입뿐 아니라 해당 App의 해석 요청 API도 서버에서 거부됩니다.
              </span>
            </span>
          </div>
        )}

        {/* 표시 메타데이터 */}
        <section className="space-y-3">
          <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <Wrench size={13} className="text-slate-400" />
            표시 정보
          </h4>

          <div>
            <label className="mb-1 block text-[11px] font-bold text-slate-600">설명</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => patch('description', e.target.value)}
              maxLength={1000}
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-bold text-slate-600">
                태그 <span className="font-normal text-slate-400">(쉼표로 구분, 최대 {MAX_TAGS}개)</span>
              </label>
              <input
                type="text"
                value={form.tags}
                onChange={(e) => patch('tags', e.target.value)}
                placeholder="트러스, 모델생성, CSV"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-slate-600">담당자</label>
              <input
                type="text"
                value={form.contributor}
                onChange={(e) => patch('contributor', e.target.value)}
                maxLength={100}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
          </div>

          {parsedTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {parsedTags.map(tag => (
                <span
                  key={tag}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
