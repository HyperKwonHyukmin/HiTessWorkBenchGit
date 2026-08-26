/// <summary>
/// 특정 가이드 문서를 모달로 표시하는 재사용 가능한 버튼 컴포넌트입니다.
///
/// 세 가지 출처를 지원합니다.
///   · guideTitle  — DB(user_guides)의 title 과 정확히 일치하는 마크다운 가이드
///   · htmlGuide   — htmlGuides.js 에 등록된 독립 HTML 문서 (표·수식이 많아 마크다운으로 힘든 것)
///   · placeholder — 아직 문서가 없을 때 띄울 안내문 (문서가 준비되면 위 둘 중 하나로 교체)
/// 우선순위는 htmlGuide > guideTitle > placeholder 입니다.
///
/// adminOnly 를 주면 관리자에게만 버튼이 보입니다. 내부 개발 문서(엔진 내부 동작·
/// 패치 이력 등)를 일반 사용자에게 노출하지 않기 위한 용도입니다.
/// </summary>
import React, { useState, useRef } from 'react';
import { BookOpen, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import Modal from './Modal';
import { getUserGuides } from '../../api/admin';
import MarkdownRenderer from './MarkdownRenderer';
import { getHtmlGuide } from './htmlGuides';
import { useAuth } from '../../contexts/AuthContext';

/** variant 별 버튼 스타일 — admin 은 '관리자 전용' 임을 색으로 구분한다 */
const VARIANT_CLASSES = {
  light: 'border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:border-indigo-300',
  dark:  'border border-white/20 bg-white/10 text-white hover:bg-white/20',
  admin: 'border border-amber-300/40 bg-amber-400/15 text-amber-100 hover:bg-amber-400/25 hover:border-amber-300/60',
};

/**
 * GuideButton
 *
 * @param {string}  [guideTitle]        - DB user_guides.title과 정확히 일치하는 문자열
 * @param {string}  [htmlGuide]         - htmlGuides.js 의 키. 주면 DB 대신 HTML 문서를 띄운다
 * @param {string}  [placeholder]       - 문서가 없을 때 모달에 띄울 안내문
 * @param {string}  [label='사용 가이드'] - 버튼 문구 및 모달 제목
 * @param {string}  [emoji='📖']         - 모달 제목 앞 이모지
 * @param {React.ComponentType} [icon]  - 버튼 아이콘 (기본 BookOpen)
 * @param {boolean} [adminOnly=false]   - true 면 관리자에게만 버튼이 보인다
 * @param {string}  [headerBg]          - 모달 헤더 배경 클래스
 * @param {string}  [size='sm']         - 'sm' | 'md' — 버튼 크기
 * @param {'light'|'dark'|'admin'} [variant='light'] - 버튼 색 계열
 */
export default function GuideButton({
  guideTitle,
  htmlGuide,
  placeholder,
  label = '사용 가이드',
  emoji = '📖',
  icon: Icon = BookOpen,
  adminOnly = false,
  headerBg = 'bg-indigo-600',
  size = 'sm',
  variant = 'light',
}) {
  const { isAdmin } = useAuth();
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
  // 실제 문서 없이 "준비 중" 안내만 띄우는 모드
  const isPlaceholder = !isHtml && !guideTitle && Boolean(placeholder);
  const heading = entry?.title ?? guideTitle ?? label;

  // 훅 호출 이후에 분기해야 훅 순서가 깨지지 않는다.
  if (adminOnly && !isAdmin) return null;

  const handleOpen = async (e) => {
    e.stopPropagation(); // 카드 등 부모 클릭 이벤트 차단
    setIsOpen(true);

    if (isPlaceholder) {
      setTitle(label);
      setContent(placeholder);
      return;
    }

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

  const modalTitle = isPlaceholder ? `${emoji} ${label}` : `${emoji} ${label} — ${title}`;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={`inline-flex items-center font-bold rounded-lg transition-colors cursor-pointer shrink-0 ${sizeClass} ${
          VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.light
        }`}
        title={isPlaceholder ? `${label} (준비 중)` : `${label}: ${heading}`}
      >
        <Icon size={size === 'md' ? 16 : 14} />
        {label}
      </button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={modalTitle}
        headerBg={headerBg}
        size={isHtml ? 'full' : isPlaceholder ? 'md' : 'xl'}
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
        ) : isPlaceholder ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="rounded-full bg-slate-100 p-4">
              <BookOpen size={28} className="text-slate-400" />
            </div>
            <p className="text-sm font-bold text-slate-700">{label} 준비 중</p>
            <p className="max-w-sm whitespace-pre-wrap text-sm leading-relaxed text-slate-500">{content}</p>
          </div>
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
