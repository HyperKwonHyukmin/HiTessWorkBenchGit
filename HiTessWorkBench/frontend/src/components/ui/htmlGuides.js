/// <summary>
/// HTML 형식 사용 가이드 레지스트리.
///
/// DB(user_guides)에 마크다운으로 들어가는 일반 가이드와 달리, 표·수식·판정 기준이 많아
/// 마크다운으로는 표현이 힘든 문서를 독립 HTML 로 유지하고 여기에 등록한다.
/// GuideButton 의 htmlGuide prop 에 키를 넘기면 모달 안 iframe 으로 뜬다.
///
/// ⚠ 원본은 각 엔진/스튜디오 저장소의 docs/ 에 있고 여기 있는 것은 배포용 사본이다.
///   원본을 고치면 이 사본도 반드시 같이 덮어써야 한다. 자동 동기화는 없다.
///   posture-stability 원본:
///     C:\Coding\WorkBenchSubModule\ModuleUnitAnalysis\docs\posture-stability-user-guide.html
///   doublepipe-fuelline: 엔진(InHouseProgram/DoublePipe/)이 git 미추적이라 별도 원본 저장소가 없다.
///     여기 있는 것이 정본이고, 엔진 폴더의 같은 이름 파일이 공동 개발자용 사본이다.
///     InHouseProgram/DoublePipe/doublepipe-fuelline-user-guide.html
/// </summary>

/**
 * 임베드용 후처리.
 *
 * 가이드 HTML 은 OS 다크 모드를 따라가도록 만들어져 있는데, WorkBench 는 라이트 전용이다.
 * 그대로 넣으면 다크 OS 사용자에게만 어두운 문서가 밝은 앱 안에 떠서 튄다.
 * 문서가 지원하는 data-theme="light" 를 박아 라이트로 고정한다.
 */
function forceLightTheme(html) {
  return html.replace(/<html\b([^>]*)>/i, (m, attrs) =>
    /data-theme=/i.test(attrs) ? m : `<html${attrs} data-theme="light">`
  );
}

/**
 * 키 → { title, load }
 * load 는 동적 import 라 버튼을 누르기 전까지 번들에 실리지 않는다(코드 스플리팅).
 */
export const HTML_GUIDES = {
  'posture-stability': {
    title: '권상 자세안정성 평가 기준',
    load: () =>
      import('../../assets/guides/posture-stability-user-guide.html?raw')
        .then(m => forceLightTheme(m.default)),
  },
  // ⚠ 관리자 전용(개발 가이드). 엔진 내부 동작·WorkBench 패치 이력이 들어 있어
  //   일반 사용자에게는 노출하지 않는다 — AnalysisPageBanner 의 devHtmlGuide 로 연결.
  'doublepipe-fuelline': {
    title: '이중관 연료배관 해석 파이프라인',
    load: () =>
      import('../../assets/guides/doublepipe-fuelline-user-guide.html?raw')
        .then(m => forceLightTheme(m.default)),
  },
};

export function getHtmlGuide(key) {
  return HTML_GUIDES[key] ?? null;
}
