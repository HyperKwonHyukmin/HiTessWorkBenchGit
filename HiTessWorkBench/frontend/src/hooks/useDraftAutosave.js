import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PREFIX = 'hitess_draft';

function storageKey(key) {
  return `${PREFIX}:${key}`;
}

function readDraft(key) {
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useDraftAutosave(key, value, { delayMs = 600, enabled = true } = {}) {
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [restoredAt, setRestoredAt] = useState(null);
  const [hasDraftState, setHasDraftState] = useState(() => Boolean(readDraft(key)?.value));
  const timerRef = useRef(null);
  const initializedRef = useRef(false);

  const draft = useMemo(() => readDraft(key), [key]);

  useEffect(() => {
    setHasDraftState(Boolean(draft?.value));
  }, [draft?.value]);

  const restoreDraft = useCallback((apply) => {
    const current = readDraft(key);
    if (!current?.value || typeof apply !== 'function') return false;
    apply(current.value);
    setRestoredAt(current.savedAt || new Date().toISOString());
    setHasDraftState(true);
    return true;
  }, [key]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(storageKey(key));
    } catch {
      // ignore
    }
    setLastSavedAt(null);
    setRestoredAt(null);
    setHasDraftState(false);
  }, [key]);

  useEffect(() => {
    initializedRef.current = true;
  }, []);

  useEffect(() => {
    if (!enabled || !initializedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      const savedAt = new Date().toISOString();
      try {
        localStorage.setItem(storageKey(key), JSON.stringify({ value, savedAt }));
        setLastSavedAt(savedAt);
        setHasDraftState(true);
      } catch {
        // ignore
      }
    }, delayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [delayMs, enabled, key, value]);

  return {
    hasDraft: hasDraftState,
    draftSavedAt: draft?.savedAt || null,
    lastSavedAt,
    restoredAt,
    restoreDraft,
    clearDraft,
  };
}
