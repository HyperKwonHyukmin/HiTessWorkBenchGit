/// <summary>
/// 특정 User Guide 항목을 모달로 표시하는 재사용 가능한 버튼 컴포넌트입니다.
///
/// 두 가지 출처를 지원합니다.
///   · guideTitle — DB(user_guides)의 title 과 정확히 일치하는 마크다운 가이드
///   · htmlGuide  — htmlGuides.js 에 등록된 독립 HTML 문서 (표·수식이 많아 마크다운으로 힘든 것)
/// 둘 다 주면 htmlGuide 가 우선합니다.
/// </summary>
import React, { useState, useRef } from 'react';
import { BookOpen, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import Modal from './Modal';
import { getUserGuides } from '../../api/admin';
import MarkdownRenderer from './MarkdownRenderer';
import { getHtmlGuide } from './htmlGuides';

/**
 * GuideButton
 *
 * @param {string}  [guideTitle]        - DB user_guides.title과 정확히 일치하는 문자열
 * @param {string}  [htmlGuide]         - htmlGuides.js 의 키. 주면 DB 대신 HTML 문서를 띄운다
 * @param {string}  [size='sm']         - 'sm' | 'md' — 버튼 크기
 * @param {'light'|'dark'} [variant='light'] - 배경 테마 ('dark' 시 흰색 계열로 렌더링)
 */
export default function GuideButton({ guideTitle, htmlGuide, size = 'sm', variant = 'light' }) {
  const [isOpen, setIsOpen]     = useState(false);
  const [content, setContent]   = useState('');
  const [html, setHtml]         = useState('');
  const [title, setTitle]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(false);
  // HTML 가이드는 표가 많아 좁은 모달에서 가로 스크롤이 잦다. 전체화면은 그때 쓰는 것이며
  // 모달을 닫아도 유지해 다시 열 때 같은 크기로 뜬다.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cacheRef                = useRef(null); // 재요청 방지 캐시

  const entry = htmlGuide ? getHtmlGuide(htmlGuide) : null;
  const isHtml = Boolean(entry);
  const label  = entry?.title ?? guideTitle;

  const handleOpen = async (e) => {
    e.stopPropagation(); // 카드 등 부모 클릭 이벤트 차단
    setIsOpen(true);

    if (cacheRef.current) {
      setTitle(cacheRef.current.title);
      if (isHtml) setHtml(cacheRef.current.html);
      else setContent(cacheRef.current.content);
      return;
    }

    setLoading(true);
    setError(false);
    try {
      if (isHtml) {
        // 번들 분리: 버튼을 눌러야 문서가 로드된다.
        const raw = await entry.load();
        cacheRef.current = { title: entry.title, html: raw };
        setTitle(entry.title);
        setHtml(raw);
      } else {
        const res = await getUserGuides();
        const guides = res.data ?? [];
        const match = guides.find(g => g.title === guideTitle);
        if (match) {
          cacheRef.current = match;
          setTitle(match.title);
          setContent(match.content);
        } else {
          setTitle(guideTitle);
          setContent('해당 가이드를 찾을 수 없습니다.\nUser Guide 메뉴에서 전체 가이드를 확인하세요.');
        }
      }
    } catch {
      setError(true);
      setTitle('가이드 로드 실패');
      setContent(isHtml
        ? '가이드 문서를 불러오지 못했습니다.'
        : '서버와 연결할 수 없어 가이드를 불러오지 못했습니다.\n서버 연결 상태를 확인하세요.');
    } finally {
      setLoading(false);
    }
  };

  const sizeClass = size === 'md'
    ? 'px-4 py-2 text-sm gap-2'
    : 'px-3 py-1.5 text-xs gap-1.5';

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={`inline-flex items-center font-bold rounded-lg transition-colors cursor-pointer shrink-0 ${sizeClass} ${
          variant === 'dark'
            ? 'border border-white/20 bg-white/10 text-white hover:bg-white/20'
            : 'border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:border-indigo-300'
        }`}
        title={`사용 가이드: ${label}`}
      >
        <BookOpen size={size === 'md' ? 16 : 14} />
        사용 가이드
      </button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={`📖 사용 가이드 — ${title}`}
        headerBg="bg-indigo-600"
        size={isHtml ? 'full' : 'xl'}
        fullscreen={isHtml && isFullscreen}
        headerActions={isHtml && !loading && !error ? (
          <button
            type="button"
            onClick={() => setIsFullscreen(v => !v)}
            className="text-white/70 hover:text-white hover:bg-white/10 rounded-lg p-1 transition-colors outline-none cursor-pointer"
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? '전체화면 해제' : '전체화면으로 보기'}
            title={isFullscreen ? '전체화면 해제' : '전체화면으로 보기'}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        ) : null}
      >
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400 gap-3">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">가이드를 불러오는 중...</span>
          </div>
        ) : error ? (
          <p className="whitespace-pre-wrap p-6 text-sm leading-relaxed text-red-500">{content}</p>
        ) : isHtml ? (
          // 문서가 자체 CSS를 통째로 들고 있어 앱 스타일과 섞이면 안 된다 → iframe 으로 격리.
          // srcDoc 이라 경로 해석이 없어 Electron(file://) 프로덕션에서도 그대로 뜬다.
          <iframe
            title={title}
            srcDoc={html}
            sandbox="allow-scripts"
            className={`block w-full border-0 bg-white ${
              isFullscreen ? 'h-full' : 'h-[calc(100vh-9rem)]'
            }`}
          />
        ) : (
          <div className="p-6">
            <MarkdownRenderer content={content} />
          </div>
        )}
      </Modal>
    </>
  );
}
