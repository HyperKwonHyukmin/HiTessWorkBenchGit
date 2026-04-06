/**
 * @fileoverview 앱 전체 페이지 네비게이션 상태를 관리하는 Context.
 * setCurrentMenu props drilling을 제거하고 useNavigation() 훅으로 접근합니다.
 * useReducer를 사용하여 history와 currentIndex를 원자적으로 업데이트합니다.
 */
import React, { createContext, useReducer, useContext } from 'react';

const NavigationContext = createContext(null);

const initialState = { history: ['Dashboard'], currentIndex: 0 };

function navReducer(state, action) {
  const { history, currentIndex } = state;
  switch (action.type) {
    case 'NAVIGATE': {
      const base = history.slice(0, currentIndex + 1);
      if (base[base.length - 1] === action.menu) return state;
      const newHistory = [...base, action.menu];
      return { history: newHistory, currentIndex: newHistory.length - 1 };
    }
    case 'GO_BACK':
      return currentIndex > 0 ? { ...state, currentIndex: currentIndex - 1 } : state;
    case 'GO_FORWARD':
      return currentIndex < history.length - 1 ? { ...state, currentIndex: currentIndex + 1 } : state;
    case 'RESET':
      return { ...initialState, history: [action.menu || 'Dashboard'], currentIndex: 0 };
    default:
      return state;
  }
}

export function NavigationProvider({ children }) {
  const [{ history, currentIndex }, dispatch] = useReducer(navReducer, initialState);

  const currentMenu = history[currentIndex];
  const canGoBack = currentIndex > 0;
  const canGoForward = currentIndex < history.length - 1;

  const setCurrentMenu = (menu) => dispatch({ type: 'NAVIGATE', menu });
  const goBack = () => dispatch({ type: 'GO_BACK' });
  const goForward = () => dispatch({ type: 'GO_FORWARD' });
  const resetNavigation = (menu) => dispatch({ type: 'RESET', menu });

  return (
    <NavigationContext.Provider value={{
      currentMenu,
      setCurrentMenu,
      goBack,
      goForward,
      canGoBack,
      canGoForward,
      resetNavigation,
    }}>
      {children}
    </NavigationContext.Provider>
  );
}

export const useNavigation = () => {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
  return ctx;
};
