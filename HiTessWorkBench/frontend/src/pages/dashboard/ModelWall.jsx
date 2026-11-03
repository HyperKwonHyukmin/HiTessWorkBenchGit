import React, { useCallback, useEffect, useState } from 'react';
import { Box, RotateCcw } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { requestModelThumbnail } from '../../utils/modelThumbnails';

/** 썸네일 한 칸 — 그릴 때까지는 뷰어 바탕색으로 자리를 지키고, 못 그리면 글자로 말한다. */
const ModelTile = ({ group, title, subtitle, chip, time, onDetail, attempt, onResult }) => {
  const { head, runs } = group;
  const [thumb, setThumb] = useState({ key: null, url: null });
  const key = `${head.id}:${attempt}`;
  useEffect(() => {
    let alive = true;
    requestModelThumbnail(head.id, API_BASE_URL).then((url) => {
      if (!alive) return;
      setThumb({ key, url: url ?? '' });
      onResult(head.id, Boolean(url));
    });
    return () => { alive = false; };
  }, [head.id, key, onResult]);
  const ready = thumb.key === key;

  return (
    <li>
      <button
        type="button"
        onClick={() => onDetail(head)}
        className="group block w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition-[border-color,box-shadow] duration-200 hover:border-blue-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <span className="relative block aspect-[8/5] overflow-hidden bg-[#1a1a2e]">
          {ready && thumb.url ? (
            <img
              src={thumb.url}
              alt={`${subtitle} 3D 모델`}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none"
            />
          ) : (
            <span className={`absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-400 ${ready ? '' : 'animate-pulse'}`}>
              <Box size={22} aria-hidden="true" />
              {ready && <span className="text-[11px]">미리보기 없음</span>}
            </span>
          )}
          {runs.length > 1 && (
            <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white">×{runs.length}</span>
          )}
        </span>
        <span className="block px-2 py-1.5">
          <span className="block truncate text-xs font-bold text-slate-800" title={head.project_name}>{subtitle}</span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{title} · {time}</span>
            {chip}
          </span>
        </span>
      </button>
    </li>
  );
};

/** 내 작업의 3D 보기 — 목록과 같은 자료를 썸네일로. describe(group) 는 목록 행과 같은 글자를 준다. */
export default function ModelWall({ groups, describe, onDetail }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(() => new Set());
  const onResult = useCallback((id, ok) => {
    setFailed((prev) => {
      if (prev.has(id) === !ok) return prev;
      const next = new Set(prev);
      if (ok) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const failedCount = groups.filter((group) => failed.has(group.head.id)).length;

  if (groups.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
        3D 로 볼 수 있는 최근 작업이 없습니다. BDF 가 있는 해석을 마치면 여기에 쌓입니다.
      </p>
    );
  }
  return (
    <>
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-4">
        {groups.map((group) => (
          <ModelTile key={group.id} group={group} onDetail={onDetail} attempt={attempt} onResult={onResult} {...describe(group)} />
        ))}
      </ul>
      {failedCount > 0 && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span>3D 미리보기를 만들지 못한 작업 {failedCount}개. 서버 연결이나 BDF 파일을 확인하세요.</span>
          <button
            type="button"
            onClick={() => { setFailed(new Set()); setAttempt((v) => v + 1); }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <RotateCcw size={12} aria-hidden="true" /> 다시 시도
          </button>
        </div>
      )}
    </>
  );
}
