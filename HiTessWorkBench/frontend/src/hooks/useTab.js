import { useState } from 'react';

/**
 * 탭 상태(활성 탭 키) 관리 훅.
 *
 * F06ParserPage / JibRestAssessment / TrussAnalysis 등 여러 페이지에서
 * `const [activeTab, setActiveTab] = useState('xxx')` 패턴을 단일 훅으로 표준화.
 *
 * 사용 예:
 *     const { activeTab, setActiveTab } = useTab(['nodes', 'members', 'result']);
 *     // 첫 항목 'nodes' 가 default 가 됨
 *
 *     const { activeTab, setActiveTab } = useTab(TABS, 'displacement');
 *     // TABS 배열 또는 객체 + 명시적 default
 *
 * @param {Array|object} tabs       탭 배열 (string[] 또는 {key,...}[]) 또는 키 객체
 * @param {string} [defaultTab]     명시적 default (생략 시 tabs 의 첫 항목 사용)
 * @returns {{ activeTab: string, setActiveTab: (key: string) => void }}
 */
export function useTab(tabs, defaultTab = null) {
  const resolveInitial = () => {
    if (defaultTab !== null && defaultTab !== undefined) return defaultTab;
    if (Array.isArray(tabs) && tabs.length > 0) {
      const first = tabs[0];
      return typeof first === 'string' ? first : (first?.key ?? null);
    }
    if (tabs && typeof tabs === 'object') {
      const keys = Object.keys(tabs);
      return keys.length > 0 ? keys[0] : null;
    }
    return null;
  };
  const [activeTab, setActiveTab] = useState(resolveInitial);
  return { activeTab, setActiveTab };
}
