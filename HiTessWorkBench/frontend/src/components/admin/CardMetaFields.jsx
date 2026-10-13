/// <summary>
/// 카탈로그 카드의 분류·그림 고르기 — App Settings 의 [설정] 창(코드 앱)과
/// 외부 App 등록 창이 함께 쓴다.
/// </summary>
import React, { useState } from 'react';
import { CardArt } from '../ui/cardArt';
import { CARD_ART_NAMES } from '../../utils/cardArt';

export const ART_LABELS = {
  truss: '트러스', frame: '프레임', pipe: '배관', lift: '권상', beam: '보',
  column: '기둥', plate: '판', weld: '용접', hull: '선체', doc: '문서',
};

const CUSTOM = '__custom__';
const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200';

/**
 * 기존 분류에서 고르거나 '직접 입력…'으로 새 분류를 만든다.
 * 직접 입력 여부는 처음 값으로 정한다 — 다른 값으로 다시 채우려면 key 로 다시 그릴 것.
 */
export function CategorySelect({ value, onChange, categories, placeholder = '분류 선택' }) {
  const [custom, setCustom] = useState(() => Boolean(value) && !categories.includes(value));
  return (
    <div className="flex gap-2">
      <select
        value={custom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            onChange('');
          } else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
        aria-label="분류"
        className={inputCls}
      >
        <option value="">{placeholder}</option>
        {categories.map(category => (
          <option key={category} value={category}>{category}</option>
        ))}
        <option value={CUSTOM}>직접 입력…</option>
      </select>
      {custom && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={40}
          autoFocus
          aria-label="새 분류"
          placeholder="새 분류"
          className={inputCls}
        />
      )}
    </div>
  );
}

/**
 * 카드 그림 고르기. value '' = 기본(defaultArt 를 미리보기로 보여 준다).
 * @param {string|null} defaultArt  기본을 골랐을 때 실제로 보일 그림 이름(없으면 null)
 * @param {string}      defaultLabel 기본 칸 이름(예: '분류 기본', '기본 그림')
 */
export function CardArtPicker({ value, onChange, defaultArt, defaultLabel = '분류 기본' }) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[''].concat(CARD_ART_NAMES).map(name => {
          const selected = (value || '') === name;
          const artForTile = name || defaultArt || null;
          return (
            <button
              key={name || 'default'}
              type="button"
              onClick={() => onChange(name)}
              aria-pressed={selected}
              className={`flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-2 transition-colors cursor-pointer ${
                selected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <span className="grid h-9 w-full place-items-center text-slate-500">
                {artForTile
                  ? <CardArt name={artForTile} draw={false} className="h-9 w-full" />
                  : <span className="text-[11px] text-slate-500">그림 없음</span>}
              </span>
              <span className={`text-[11px] font-bold ${selected ? 'text-blue-700' : 'text-slate-600'}`}>
                {name ? ART_LABELS[name] || name : defaultLabel}
              </span>
            </button>
          );
        })}
      </div>
      {!(value || defaultArt) && (
        <p className="mt-1 text-[11px] text-slate-500">그림이 없으면 카드에는 모눈과 분류 이름표만 보입니다.</p>
      )}
    </div>
  );
}
