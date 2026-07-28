/**
 * 관리자가 App Settings 에서 지정한 App별 오버라이드 저장소.
 *
 * 앱 카탈로그의 **원본은 코드**(DashboardContext 의 ANALYSIS_DATA)이고, 이 모듈은
 * 그 위에 덮을 값만 백엔드에서 받아 들고 있는다. 오버라이드가 없는 앱은 코드
 * 기본값을 그대로 쓰므로, 코드에 앱을 새로 추가해도 DB 를 미리 손댈 필요가 없다.
 *
 * ⚠ 이 모듈은 ANALYSIS_DATA 를 import 하지 않는다(순환 참조 방지).
 *    카탈로그와 합친 '실효 목록'은 DashboardContext 의 useAppCatalogue() 가 준다.
 */
import { useSyncExternalStore } from 'react';
import { getAppSettings } from '../api/appSettings';

const EMPTY = Object.freeze({});

let overrides = EMPTY;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return overrides;
}

/** 서버 응답(배열)을 app_key 기준 map 으로 바꿔 저장한다. */
export function setAppSettingOverrides(list) {
  const next = {};
  (Array.isArray(list) ? list : []).forEach((row) => {
    if (row?.app_key) next[row.app_key] = row;
  });
  overrides = Object.freeze(next);
  emit();
}

export function getAppSettingOverrides() {
  return overrides;
}

/** 백엔드에서 최신 오버라이드를 다시 읽는다. 실패는 조용히 무시(기존 값 유지). */
export async function refreshAppSettings() {
  try {
    const res = await getAppSettings();
    setAppSettingOverrides(res.data);
    return true;
  } catch {
    return false;
  }
}

/** 로그아웃 시 등 — 오버라이드를 비워 코드 기본값으로 되돌린다. */
export function clearAppSettings() {
  if (overrides === EMPTY) return;
  overrides = EMPTY;
  emit();
}

/** 오버라이드 map 을 구독한다. 값이 바뀌면 컴포넌트가 다시 그려진다. */
export function useAppSettings() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const DEFAULT_MAINTENANCE_MESSAGE = '현재 점검 중입니다. 잠시 후 다시 시도해주세요.';

/**
 * 코드 기본값(app) 위에 오버라이드(setting)를 덮은 새 객체를 만든다.
 *
 * 서버가 null 로 준 필드는 '오버라이드 없음'이므로 코드 기본값을 유지한다.
 * maintenance 계열은 코드에 대응 값이 없는 순수 런타임 필드다.
 */
export function mergeAppSetting(app, setting) {
  if (!app) return app;
  if (!setting) return app;

  const merged = { ...app };
  if (setting.dev_status) merged.devStatus = setting.dev_status;
  if (setting.description) merged.description = setting.description;
  if (Array.isArray(setting.tags) && setting.tags.length) merged.tags = setting.tags;
  if (setting.contributor) merged.contributor = setting.contributor;
  merged.maintenance = Boolean(setting.maintenance);
  merged.maintenanceMessage = setting.maintenance_message || null;
  merged.hasAdminOverride = true;
  return Object.freeze(merged);
}

/**
 * 일반 사용자 기준 차단 판정.
 * @returns {{reason: string, message: string|null}|null} 통과면 null.
 */
export function getAppBlock(app) {
  if (!app) return null;
  if (app.maintenance) {
    return {
      reason: 'maintenance',
      message: app.maintenanceMessage || DEFAULT_MAINTENANCE_MESSAGE,
    };
  }
  if (app.devStatus === 'Developing' || app.devStatus === 'Planned') {
    return { reason: app.devStatus, message: null };
  }
  return null;
}

/** 관리자는 개발·점검 중인 앱도 확인해야 하므로 차단하지 않는다. */
export function isAppBlockedFor(app, isAdmin) {
  return !isAdmin && Boolean(getAppBlock(app));
}
