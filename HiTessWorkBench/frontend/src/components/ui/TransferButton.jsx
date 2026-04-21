import React from 'react';
import { ArrowUpRight, FileText } from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';

/**
 * 크로스앱 결과 전달 버튼.
 * ANALYSIS_DATA의 transferOutputs 설정을 읽어 사용 가능한 전달 경로를 자동으로 렌더링한다.
 * 새로운 앱 간 연결을 추가할 때는 ANALYSIS_DATA만 수정하면 된다.
 *
 * @param {number} analysisId - DB analysis.id
 * @param {object} resultInfo - analysis result_info (서버 반환 JSON)
 * @param {string} sourceApp  - ANALYSIS_DATA title (현재 앱)
 */
export default function TransferButton({ analysisId, resultInfo, sourceApp }) {
  const { setCurrentMenu } = useNavigation();
  const { setPendingJobTransfer } = useDashboard();

  const appMeta = ANALYSIS_DATA.find(a => a.title === sourceApp);
  const outputs = appMeta?.transferOutputs ?? [];

  if (!outputs.length || !resultInfo || !analysisId) return null;

  const available = outputs.filter(o => resultInfo[o.key]);
  if (!available.length) return null;

  return (
    <div className="flex flex-col gap-2">
      {available.map(output => (
        <button
          key={output.key}
          onClick={() => {
            setPendingJobTransfer({
              analysisId,
              filePath: resultInfo[output.key],
              fileKey: output.key,
              projectName: `${sourceApp} 결과 (ID: ${analysisId})`,
              sourceApp,
              targetApp: output.targetApp,
            });
            setCurrentMenu(output.targetApp);
          }}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer shadow-sm"
        >
          <FileText size={13} />
          <span className="flex-1 text-left">{output.targetApp}로 이어서 분석</span>
          <ArrowUpRight size={13} />
        </button>
      ))}
    </div>
  );
}
