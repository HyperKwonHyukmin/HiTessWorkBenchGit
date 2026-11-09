/// <summary>
/// Studio 사용 설명서 버튼 — 페이지 배너에 두면 모달에서 설명서(웹판)를 보고 PDF 를 받는다.
///
/// 설명서는 백엔드 Manuals/<id>/ 에 있다(app/routers/manuals.py). 프론트 번들에 넣지 않아
/// 설명서를 고쳐도 exe 재배포 없이 145 git pull 로 바뀐다. 만드는 곳: outputs/manual-tools(make.mjs → publish.py).
/// 같은 웹판이 Studio 도움말의 '사용 설명서' 탭에도 들어 있다(Studio zip 동봉).
/// </summary>
import { useRef, useState } from 'react';
import { BookMarked, Download, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import Modal from './Modal';
import { useToast } from '../../contexts/ToastContext';
import { downloadManualPdf, getManualHtml, getManualInfo } from '../../api/manuals';

/**
 * @param {string} manualId           - 백엔드 설명서 id (예: 'module-unit')
 * @param {string} [label='Studio 사용 설명서']
 */
export default function StudioManualButton({ manualId, label = 'Studio 사용 설명서' }) {
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState({ loading: false, error: null, html: '', info: null });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const loadedRef = useRef(false);

  const open = async () => {
    setIsOpen(true);
    if (loadedRef.current) return;
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const [info, html] = await Promise.all([getManualInfo(manualId).then(r => r.data), getManualHtml(manualId)]);
      loadedRef.current = true;
      setState({ loading: false, error: null, html, info });
    } catch (e) {
      const status = e?.response?.status;
      setState(s => ({ ...s, loading: false,
        error: status === 404 ? '서버에 설명서가 아직 없습니다. 서버 업데이트 후 다시 열어 주세요.'
          : '설명서를 불러오지 못했습니다. 서버 연결 상태를 확인하세요.' }));
    }
  };

  const savePdf = async () => {
    setDownloading(true);
    try {
      const name = await downloadManualPdf(manualId, state.info?.pdfFileName);
      showToast(`설명서 PDF 를 받았습니다: ${name}`, 'success');
    } catch {
      showToast('설명서 PDF 를 받지 못했습니다.', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const info = state.info;
  const title = info ? `${info.title} · 문서 버전 ${info.version}` : label;
  const iconBtn = 'text-white/70 hover:text-white hover:bg-white/10 rounded-lg p-1 transition-colors outline-none cursor-pointer';

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/20"
        title="Studio 사용 설명서를 보고 PDF 로 받습니다"
      >
        <BookMarked size={14} />
        {label}
      </button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={title}
        headerBg="bg-brand-blue"
        size="full"
        fullscreen={isFullscreen}
        headerActions={(
          <>
            {info?.hasPdf && (
              <button
                type="button"
                onClick={savePdf}
                disabled={downloading}
                className="mr-1 inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-white/20 disabled:cursor-wait disabled:opacity-60"
              >
                {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                PDF 받기
              </button>
            )}
            {!state.loading && !state.error && (
              <button
                type="button"
                onClick={() => setIsFullscreen(v => !v)}
                className={iconBtn}
                aria-pressed={isFullscreen}
                aria-label={isFullscreen ? '전체화면 해제' : '전체화면으로 보기'}
                title={isFullscreen ? '전체화면 해제' : '전체화면으로 보기'}
              >
                {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            )}
          </>
        )}
      >
        {state.loading ? (
          <div className="flex items-center justify-center gap-3 py-12 text-slate-500">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">설명서를 불러오는 중...</span>
          </div>
        ) : state.error ? (
          <p className="whitespace-pre-wrap p-6 text-sm leading-relaxed text-red-600">{state.error}</p>
        ) : (
          <>
            {info && (
              <p className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-600">
                기준 {info.studioName} {info.studio} · {info.date}. 사용 중인 Studio 가 더 새로우면 일부 화면이 다를 수 있습니다.
              </p>
            )}
            {/* 문서 CSS 가 앱 스타일과 섞이지 않게 iframe 으로 격리. srcDoc 이라 file:// 프로덕션에서도 경로 문제 없음 */}
            <iframe
              title={title}
              srcDoc={state.html}
              sandbox="allow-scripts"
              className={`block w-full border-0 bg-slate-200 ${isFullscreen ? 'h-[calc(100vh-6.5rem)]' : 'h-[calc(100vh-11rem)]'}`}
            />
          </>
        )}
      </Modal>
    </>
  );
}
