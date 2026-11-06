/// <summary>
/// 목록 화면 필터용 드롭다운 — OS 기본 select 대신 앱과 같은 모양으로 보인다.
/// options: [{ value, label, hint?, group? }]. group 이 있으면 같은 group 끼리 머리글 아래 묶는다(처음 나온 순서).
/// defaultValue 와 다른 값이 골라져 있으면 '필터 걸림' 으로 파랗게 표시한다.
/// </summary>
import React from 'react';
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { Check, ChevronDown } from 'lucide-react';

function groupOptions(options) {
  const groups = [];
  const byName = new Map();
  for (const opt of options) {
    const name = opt.group || '';
    if (!byName.has(name)) {
      const g = { name, items: [] };
      byName.set(name, g);
      groups.push(g);
    }
    byName.get(name).items.push(opt);
  }
  return groups;
}

export default function FilterListbox({
  value, onChange, options, label, defaultValue = 'All', icon: Icon, className = '', widthClass = 'w-[11rem]',
}) {
  const current = options.find(o => o.value === value);
  const active = value !== defaultValue;
  const groups = groupOptions(options);

  return (
    <Listbox value={value} onChange={onChange}>
      <ListboxButton
        aria-label={label}
        className={`group relative inline-flex h-10 items-center gap-2 rounded-lg border pl-3 pr-8 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${widthClass} ${
          active
            ? 'border-blue-300 bg-blue-50 font-semibold text-brand-blue'
            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
        } ${className}`}
      >
        {Icon && <Icon size={15} className={active ? 'text-brand-blue' : 'text-slate-400'} aria-hidden="true" />}
        <span className="block min-w-0 truncate" title={current?.label}>{current?.label ?? label}</span>
        <ChevronDown
          size={15}
          className="pointer-events-none absolute right-2.5 text-slate-400 transition-transform group-data-[open]:rotate-180"
          aria-hidden="true"
        />
      </ListboxButton>
      <ListboxOptions
        anchor={{ to: 'bottom start', gap: 4 }}
        className="z-50 max-h-[22rem] min-w-[var(--button-width)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-[0_8px_24px_-6px_rgba(15,23,42,0.18)] focus:outline-none"
      >
        {groups.map((g, gi) => (
          <div key={g.name || `g${gi}`} role="presentation" className={gi > 0 && g.name ? 'mt-1 border-t border-slate-100 pt-1' : ''}>
            {g.name && (
              <div role="presentation" className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-slate-500">{g.name}</div>
            )}
            {g.items.map(opt => (
              <ListboxOption
                key={opt.value}
                value={opt.value}
                className="group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-slate-700 data-[focus]:bg-slate-100 data-[selected]:font-semibold data-[selected]:text-brand-blue"
              >
                <Check size={14} className="invisible shrink-0 text-brand-blue group-data-[selected]:visible" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                {opt.hint && <span className="shrink-0 font-mono text-[11px] font-normal text-slate-500">{opt.hint}</span>}
              </ListboxOption>
            ))}
          </div>
        ))}
      </ListboxOptions>
    </Listbox>
  );
}
