import React from 'react';
import { UploadCloud } from 'lucide-react';
import AppCataloguePage from '../../components/analysis/AppCataloguePage';

export default function NewAnalysis() {
  return (
    <AppCataloguePage
      mode="File"
      title="File-Based Apps"
      icon={UploadCloud}
      subtitle="수행하고자 하는 파일 업로드 기반 해석 모델을 선택하십시오."
    />
  );
}
