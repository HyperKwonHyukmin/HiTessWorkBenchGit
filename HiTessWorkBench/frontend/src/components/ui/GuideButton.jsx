/// <summary>
/// 특정 User Guide 항목을 모달로 표시하는 재사용 가능한 버튼 컴포넌트입니다.
/// guideTitle prop으로 DB의 가이드 title과 매칭하여 해당 내용을 팝업으로 보여줍니다.
/// </summary>
import React, { useState, useRef } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import Modal from './Modal';
import { getUserGuides } from '../../api/admin';

/**
 * GuideButton
 *
 * @param {string} guideTitle  - DB user_guides.title과 정확히 일치하는 문자열
 * @param {string} [size='sm'] - 'sm' | 'md' — 버튼 크기
 */
export default function GuideButton({ guideTitle, size = 'sm' }) {
  const [isOpen, setIsOpen]     = useState(false);
  const [content, setContent]   = useState('');
  const [title, setTitle]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(false);
  const cacheRef                = useRef(null); // 재요청 방지 캐시

  const handleOpen = async (e) => {
    e.stopPropagation(); // 카드 등 부모 클릭 이벤트 차단
    setIsOpen(true);

    if (cacheRef.current) {
      setTitle(cacheRef.current.title);
      setContent(cacheRef.current.content);
      return;
    }

    setLoading(true);
    setError(false);
    try {
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
    } catch {
      setError(true);
      setTitle('가이드 로드 실패');
      setContent('서버와 연결할 수 없어 가이드를 불러오지 못했습니다.\n서버 연결 상태를 확인하세요.');
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
        className={`inline-flex items-center font-bold rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:border-indigo-300 transition-colors cursor-pointer shrink-0 ${sizeClass}`}
        title={`사용 가이드: ${guideTitle}`}
      >
        <BookOpen size={size === 'md' ? 16 : 14} />
        사용 가이드
      </button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={`📖 사용 가이드 — ${title}`}
        headerBg="bg-indigo-600"
        size="xl"
      >
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400 gap-3">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">가이드를 불러오는 중...</span>
            </div>
          ) : (
            <p className={`whitespace-pre-wrap text-sm leading-relaxed ${error ? 'text-red-500' : 'text-slate-600'}`}>
              {content}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
