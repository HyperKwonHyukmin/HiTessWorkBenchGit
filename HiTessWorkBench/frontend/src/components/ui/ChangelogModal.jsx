/// <summary>
/// 솔버별 개발 이력 모달 — PageHeader '이력' 버튼, BDF Scanner, F06 Parser 에서 연다.
/// 이 PC 에서 지난번에 연 뒤 더해진 버전에 '새 항목'을 붙인다(관리자 업데이트 이력과 같은 규칙).
/// </summary>
import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import Badge from './Badge';
import { CHANGELOG, CHANGELOG_TYPE_META, changelogKey } from '../../constants/changelog';
import { newIndexes, readSeen, writeSeen } from '../../utils/updateHistory';

const seenStorageKey = (programKey) => `wb_changelog_seen:${programKey}`;

export default function ChangelogModal({ programKey, title, isOpen, onClose }) {
  const entries = CHANGELOG[programKey] ?? [];
  const [fresh, setFresh] = useState(() => new Set());

  // 열 때 한 번만 판정하고, 맨 위 항목을 '본 것'으로 남긴다(다음에 열 때의 기준).
  useEffect(() => {
    if (!isOpen || entries.length === 0) return;
    const key = seenStorageKey(programKey);
    setFresh(newIndexes(entries, readSeen(key), changelogKey));
    writeSeen(key, changelogKey(entries[0]));
  }, [isOpen, programKey, entries]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${title} 개발 이력`}
      size="lg"
      footer={
        <p className="text-xs text-slate-500">
          최신 버전이 위에 있습니다. '새 항목'은 이 PC 에서 지난번에 이력을 연 뒤 더해진 버전입니다.
        </p>
      }
    >
      <div className="px-6 py-5">
        {entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">등록된 이력이 없습니다.</p>
        ) : (
          <>
            {fresh.size > 0 && (
              <p className="mb-4 text-xs font-semibold text-slate-700">지난번에 본 뒤 새 항목 {fresh.size}건</p>
            )}
            <ol className="relative ml-1 space-y-6 border-l border-slate-200">
              {entries.map((entry, i) => {
                const meta = CHANGELOG_TYPE_META[entry.type] ?? CHANGELOG_TYPE_META.feat;
                const isNew = fresh.has(i);
                return (
                  <li key={changelogKey(entry)} className="relative pl-5">
                    <span
                      className={`absolute -left-[5px] top-1.5 h-[9px] w-[9px] rounded-full border-[1.5px] ${
                        isNew ? 'border-brand-blue bg-brand-blue' : 'border-slate-300 bg-white'
                      }`}
                      aria-hidden="true"
                    />
                    <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-bold text-slate-800">v{entry.version}</span>
                      <span className="font-mono text-xs text-slate-500">{entry.date}</span>
                      {isNew && <Badge variant="notify" size="sm">새 항목</Badge>}
                      <Badge variant={meta.variant} size="sm">{meta.label}</Badge>
                    </div>
                    <ul className="space-y-1">
                      {entry.changes.map((c) => (
                        <li key={c} className="flex items-start gap-2 text-sm leading-relaxed text-slate-700">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
                          {c}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </Modal>
  );
}
