import React from 'react';
import { GitCommit } from 'lucide-react';
import Modal from './Modal';
import { CHANGELOG, CHANGELOG_TYPE_META } from '../../constants/changelog';

export default function ChangelogModal({ programKey, title, isOpen, onClose }) {
  const entries = CHANGELOG[programKey] ?? [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${title} — 개발 이력`}
      size="lg"
      footer={
        <p className="text-xs text-slate-400">
          최신 버전이 항상 상단에 표시됩니다. 이력은 개발팀이 직접 관리합니다.
        </p>
      }
    >
      <div className="px-6 py-5">
        {entries.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">등록된 이력이 없습니다.</p>
        ) : (
          <ol className="relative border-l border-slate-200 space-y-8 ml-2">
            {entries.map((entry, i) => {
              const meta = CHANGELOG_TYPE_META[entry.type] ?? CHANGELOG_TYPE_META.feat;
              return (
                <li key={i} className="ml-6">
                  {/* 타임라인 점 */}
                  <span className="absolute -left-[9px] flex items-center justify-center w-[18px] h-[18px] bg-white border-2 border-brand-blue rounded-full">
                    <GitCommit size={10} className="text-brand-blue" />
                  </span>

                  {/* 헤더 행 */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${meta.color}`}>
                      {meta.label}
                    </span>
                    <span className="text-sm font-bold text-slate-800">v{entry.version}</span>
                    <span className="text-xs text-slate-400">{entry.date}</span>
                  </div>

                  {/* 변경 사항 목록 */}
                  <ul className="space-y-1">
                    {entry.changes.map((c, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm text-slate-600">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Modal>
  );
}
