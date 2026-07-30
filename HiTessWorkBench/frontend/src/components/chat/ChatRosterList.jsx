/**
 * @fileoverview 채팅 도크 목록 화면 — 관리자 로스터 + 기타 대화.
 *
 * 자체 조회·폴링을 하지 않는 표현 전용 컴포넌트다. 데이터는 ChatDock 이 소유하고
 * buildChatSections() 결과를 sections 로 받는다.
 */
import React from 'react';
import { Trash2 } from 'lucide-react';
import { formatChatTime, statusDotClass, statusLabel } from '../../utils/chatContacts';

function Avatar({ name, id }) {
  const label = (name || id || '?').trim().charAt(0).toUpperCase();
  return (
    <div className="h-9 w-9 shrink-0 rounded-xl bg-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center font-bold">
      {label}
    </div>
  );
}

function Row({ row, onPick, onDelete }) {
  // 대화 이력이 없는 관리자에게는 삭제할 대화가 없다 → 삭제 버튼을 숨긴다.
  const hasHistory = !!row.last_at;
  return (
    <div className="group/row flex items-center gap-2 px-3 py-3 hover:bg-slate-50 border-b border-slate-100">
      <button
        type="button"
        onClick={() => onPick(row)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
      >
        <Avatar name={row.name} id={row.other_id} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-700 truncate">{row.name}</span>
            {row.status && (
              <span className="inline-flex items-center gap-1 shrink-0 text-[10px] text-slate-500">
                <span
                  className={`h-2 w-2 rounded-full ${statusDotClass(row.status)}`}
                  aria-hidden="true"
                />
                {statusLabel(row.status)}
              </span>
            )}
            {hasHistory && (
              <span className="text-[10px] text-slate-400 ml-auto shrink-0">
                {formatChatTime(row.last_at)}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {row.last_message || row.department || '대화를 시작해 보세요.'}
          </div>
        </div>
      </button>
      {row.unread > 0 && (
        <span className="min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
          {row.unread}
        </span>
      )}
      {hasHistory && (
        <button
          type="button"
          onClick={() => onDelete(row)}
          className="shrink-0 rounded-lg p-1.5 text-slate-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover/row:opacity-100 cursor-pointer"
          title="대화 삭제"
          aria-label={`${row.name} 대화 삭제`}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
      {children}
    </div>
  );
}

export default function ChatRosterList({ sections, onPick, onDelete, error = false }) {
  const { roster, others } = sections;

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <SectionTitle>관리자</SectionTitle>
      {roster.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-slate-400">
          {error
            ? '관리자 목록을 불러올 수 없습니다. 잠시 후 다시 시도합니다.'
            : '현재 등록된 관리자가 없습니다.'}
        </p>
      ) : (
        roster.map((row) => (
          <Row key={row.other_id} row={row} onPick={onPick} onDelete={onDelete} />
        ))
      )}

      {others.length > 0 && (
        <>
          <SectionTitle>기타 대화</SectionTitle>
          {others.map((row) => (
            <Row key={row.other_id} row={row} onPick={onPick} onDelete={onDelete} />
          ))}
        </>
      )}
    </div>
  );
}
