import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

// 지나가는 마우스에 영상이 깜빡이지 않게 잠깐 머문 뒤 띄운다.
const PREVIEW_HOVER_MS = 350;
// 재생 표는 3시간 유효하다. 그 전에 다시 받아 오래 열어 둔 화면에서도 끊기지 않게 한다.
const REFRESH_MS = 60 * 60 * 1000;
// 목록을 못 받았으면 서버가 돌아올 때를 기다려 다시 묻는다 — 대시보드는 앱을 켜 둔 내내 떠 있다.
const RETRY_MS = 60 * 1000;
let cache = { at: 0, promise: null };

function loadClips() {
  if (cache.promise && Date.now() - cache.at < REFRESH_MS) return cache.promise;
  const promise = axios.get(`${API_BASE_URL}/api/videos/previews`, { headers: getAuthHeaders() })
    .then((res) => res.data ?? {})
    .catch(() => ({}))
    .then((data) => {
      if (Object.keys(data).length === 0) cache = { at: 0, promise: null };
      return data;
    });
  cache = { at: Date.now(), promise };
  return promise;
}

/** 앱 카드 미리보기 — (앱 title) → 재생 주소 | undefined. 실패하면 빈 표라 카드는 예전 그대로다. */
export function useAppPreviewClips() {
  const [clips, setClips] = useState({});
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const load = () => loadClips().then((data) => {
      if (!alive) return;
      setClips(data);
      timer = window.setTimeout(load, Object.keys(data).length > 0 ? REFRESH_MS : RETRY_MS);
    });
    load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);
  return useCallback((title) => (clips[title] ? `${API_BASE_URL}${clips[title]}` : undefined), [clips]);
}

/** 마우스를 올리면 재생 여부. 움직임 줄이기 설정이면 재생하지 않는다. src 가 없으면 아무 일도 없다. */
export function usePreviewHover(src) {
  const [playing, setPlaying] = useState(false);
  const timer = useRef(0);
  if (!src) return { playing: false, hoverProps: {}, stop: () => {} };
  const stop = () => {
    window.clearTimeout(timer.current);
    setPlaying(false);
  };
  return {
    playing,
    stop,
    hoverProps: {
      onMouseEnter: () => {
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        timer.current = window.setTimeout(() => setPlaying(true), PREVIEW_HOVER_MS);
      },
      onMouseLeave: stop,
    },
  };
}
