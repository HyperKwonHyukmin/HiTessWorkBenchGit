import React from 'react';
import { Bot } from 'lucide-react';
import AppCataloguePage from '../../components/analysis/AppCataloguePage';

export default function AiAssistantHub() {
  return (
    <AppCataloguePage
      mode="AI"
      title="AI Based Apps"
      icon={Bot}
      subtitle="최신 인공지능 기술을 활용하여 구조 해석 업무 생산성을 극대화하십시오."
      accentColor="cyan"
      emptyIcon={Bot}
      emptyTitle="준비 중인 AI 서비스가 곧 추가될 예정입니다."
      emptySubtitle="새로운 AI 도구를 기대해 주세요."
    />
  );
}
