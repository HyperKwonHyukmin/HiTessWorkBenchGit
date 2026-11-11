/// <summary>
/// 관리자 메뉴 한 칸 아래 여러 화면을 탭으로 묶는 틀(constants/adminMenus.js ADMIN_TAB_GROUPS).
/// 탭을 누르면 그 탭의 메뉴 이름으로 이동한다 — 뒤로 가기·시작 화면·화면별 체류 기록이 탭 단위로 남는다.
/// 각 화면은 자기 머리(PageHeader)를 그대로 쓴다. 이 틀은 위에 탭 줄만 더한다.
/// </summary>
import React from 'react';
import FilterTabs from '../ui/FilterTabs';
import { useNavigation } from '../../contexts/NavigationContext';
import { ADMIN_TAB_GROUPS, activeAdminTab } from '../../constants/adminMenus';

// 탭 줄을 각 화면의 머리(PageHeader)와 같은 폭에 둔다 — 화면마다 바깥 폭이 달라 하나로 고정하면 제목과 어긋난다.
const TAB_BAR_WIDTH = {
  'App Community': 'max-w-7xl mx-auto',
  'API Apps': 'max-w-7xl mx-auto',
  'Update History': 'max-w-4xl mx-auto',
};

export default function AdminTabHub({ group, renderTab }) {
  const { currentMenu, setCurrentMenu } = useNavigation();
  const tabs = ADMIN_TAB_GROUPS[group] || [];
  const active = activeAdminTab(group, currentMenu);
  const labelOf = (menu) => tabs.find((t) => t.menu === menu)?.label ?? menu;

  return (
    <div>
      <div className={`${TAB_BAR_WIDTH[active] || ''} mb-4`}>
        <FilterTabs
          dense
          categories={tabs.map((t) => t.label)}
          active={labelOf(active)}
          onChange={(label) => {
            const tab = tabs.find((t) => t.label === label);
            if (tab && tab.menu !== active) setCurrentMenu(tab.menu);
          }}
        />
      </div>
      {renderTab(active)}
    </div>
  );
}
