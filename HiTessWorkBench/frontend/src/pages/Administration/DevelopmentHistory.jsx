/// <summary>
/// 관리자 Development History — Hi-TESS 개발 연대기(처음부터 지금까지 어떤 순서로 만들어졌는지).
/// 화면은 서버의 공개 페이지(/history, 백엔드 HistoryWeb/ · routers/history_web.py)를 그대로 넣어 보여 준다.
/// 내용·숫자는 서버 파일이라 고쳐서 올리면 exe 재배포 없이 바뀐다. 같은 페이지를 로그인 없이 브라우저로도 연다.
/// </summary>
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Milestone, RefreshCw } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import FeedbackState from '../../components/ui/FeedbackState';
import { API_BASE_URL } from '../../config';
import { useToast } from '../../contexts/ToastContext';
import { publicPageUrl } from '../../utils/publicPageUrl';

const HEADER_BUTTON =
  'flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20';

export default function DevelopmentHistory() {
  const { showToast } = useToast();
  const frameRef = useRef(null);
  const [state, setState] = useState('loading');   // loading | ready | missing | error
  const [height, setHeight] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const embedUrl = `${API_BASE_URL}/history/?embed=1`;
  const shareUrl = publicPageUrl(API_BASE_URL, '/history');

  // 서버에 페이지가 있는지 먼저 본다 — 옛 서버면 iframe 안에 404 글자만 덩그러니 뜬다.
  // axios 가 아니라 fetch 로 묻는다: 옛 서버의 404 가 앱의 네트워크 진단 경고로 쌓이지 않게(리뷰 반영).
  const check = useCallback((signal) => {
    setState('loading');
    setHeight(null);
    fetch(`${API_BASE_URL}/history/`, { signal, cache: 'no-store' })
      .then((res) => setState(res.ok ? 'ready' : res.status === 404 ? 'missing' : 'error'))
      .catch((err) => { if (err?.name !== 'AbortError') setState('error'); });
  }, []);

  // 앱(Electron)에서는 시스템 브라우저로 넘긴다 — 본창의 window.open 은 앱 창을 하나 더 띄울 뿐이다(리뷰 반영).
  const openInBrowser = () => {
    if (window.electron?.send) window.electron.send('open-external', shareUrl);
    else window.open(shareUrl, '_blank', 'noopener');
  };

  useEffect(() => {
    const controller = new AbortController();
    check(controller.signal);
    return () => controller.abort();
  }, [check, reloadKey]);

  // 페이지가 알려 주는 제 높이에 맞춰 iframe 을 늘린다(스크롤이 두 겹이 되지 않게). 우리 iframe 이 보낸 것만 받는다.
  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const h = Number(event.data?.hitessHistoryHeight);
      if (Number.isFinite(h) && h > 200 && h < 40000) setHeight(Math.ceil(h));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('주소를 복사했습니다. 로그인 없이 사내 브라우저로 열립니다.', 'success');
    } catch {
      showToast(`복사하지 못했습니다. 직접 적어 주세요: ${shareUrl}`, 'error');
    }
  };

  return (
    <div className="pb-28">
      <PageHeader
        title="Development History"
        icon={Milestone}
        subtitle="Hi-TESS 개발 연대기. 처음부터 지금까지 어떤 순서로 만들어졌는지 보여 줍니다."
        accentColor="indigo"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setReloadKey((k) => k + 1)} className={HEADER_BUTTON}>
              <RefreshCw size={14} className={state === 'loading' ? 'animate-spin' : ''} aria-hidden="true" /> 새로 고침
            </button>
            <button type="button" onClick={copyLink} className={HEADER_BUTTON}>
              <Copy size={14} aria-hidden="true" /> 주소 복사
            </button>
            <button type="button" onClick={openInBrowser} className={HEADER_BUTTON}>
              <ExternalLink size={14} aria-hidden="true" /> 브라우저로 열기
            </button>
          </div>
        )}
      />

      <p className="mx-auto mb-4 max-w-7xl text-xs text-slate-500">
        같은 페이지를 로그인 없이 여는 주소: <span className="font-mono text-slate-700 select-all">{shareUrl}</span>
        <span className="ml-2">팀원에게는 이 주소를 알려 주면 됩니다.</span>
      </p>

      {state === 'loading' && <FeedbackState variant="loading" title="개발 연대기를 불러오는 중입니다" />}
      {state === 'missing' && (
        <FeedbackState
          variant="empty"
          title="서버에 개발 연대기 페이지가 아직 없습니다"
          message="서버가 이 기능이 들어가기 전 버전입니다. 서버를 업데이트한 뒤 새로 고침을 눌러 주세요."
        />
      )}
      {state === 'error' && (
        <FeedbackState
          variant="error"
          title="개발 연대기를 불러오지 못했습니다"
          message="서버 연결을 확인한 뒤 새로 고침을 눌러 주세요."
        />
      )}
      {state === 'ready' && (
        <iframe
          key={reloadKey}
          ref={frameRef}
          title="Hi-TESS 개발 연대기"
          src={embedUrl}
          className="mx-auto block w-full max-w-7xl rounded-xl border border-slate-200 bg-white"
          style={{ height: height ? `${height}px` : '80vh' }}
        />
      )}
    </div>
  );
}
