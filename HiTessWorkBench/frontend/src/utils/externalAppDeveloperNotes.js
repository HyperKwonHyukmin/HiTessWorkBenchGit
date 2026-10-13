/**
 * App Settings 외부 App 등록 창의 '외부 개발자에게 알려줄 사항'.
 *
 * 2026-10-13 실측(가짜 외부 앱 + 실제 Chromium/Electron 창)으로 확인한 동작만 적는다.
 * 프록시(routers/external_apps.py)·Electron(electron/external-app-paths.js) 동작이 바뀌면 같이 고칠 것.
 */

/**
 * @param {{host?: string, port?: string|number, slug?: string}} app
 * @returns {Array<{heading: string, items: string[]}>}
 */
export function buildDeveloperNotes({ host, port, slug } = {}) {
  const address = host && port ? `http://${String(host).trim()}:${port}` : 'http://<IP>:<Port>';
  const entry = slug ? `/external-apps/${slug}` : '/external-apps/<주소 이름>';
  return [
    {
      heading: '주소와 사용자',
      items: [
        `사용자는 ${address}/<사번> 으로 들어옵니다(예: /A123456). 로그인한 사람의 사번은 주소의 첫 칸에서 읽으세요.`,
        `연결 상태 확인을 위해 WorkBench 가 ${address}/ 를 GET 으로 부릅니다. 500 미만으로 응답하게 두세요.`,
        '주소는 http 로 엽니다(https 아님).',
      ],
    },
    {
      heading: '로그인·보안',
      items: [
        'WorkBench 가 로그인과 계정 상태를 확인한 뒤에만 요청을 넘깁니다. 다른 사람 사번 주소는 WorkBench 가 막습니다.',
        'WorkBench 로그인 토큰·쿠키는 외부 앱으로 넘어가지 않습니다.',
        `${address} 로 직접 들어오면 이 확인을 거치지 않습니다. 서버 방화벽에서 WorkBench 서버만 접속하게 막아 두세요.`,
      ],
    },
    {
      heading: '화면·요청 경로',
      items: [
        "'/' 로 시작하는 경로(/assets/app.js, fetch('/api/…'))와 상대 경로(assets/app.js) 모두 됩니다.",
        `${address}/… 처럼 주소를 통째로 적은 요청은 WorkBench 를 거치지 않아 실패합니다.`,
        'WebSocket 은 지원하지 않습니다. 진행 상황은 짧은 간격으로 물어보는 방식(폴링)으로 만드세요.',
        '새 창(window.open, target="_blank")은 WorkBench 밖 시스템 브라우저로 열려 로그인이 없습니다. 같은 창 안에서 이동하세요.',
      ],
    },
    {
      heading: '요청 크기·시간',
      items: [
        '요청 하나는 30초 안에 응답해야 합니다. 넘으면 사용자는 오류(504)를 봅니다. 오래 걸리는 계산은 작업을 시작하고 상태를 나눠 확인하게 만드세요.',
        '한 번에 보낼 수 있는 요청 본문(업로드)은 25MB까지입니다. 다운로드는 크기 제한이 없습니다.',
      ],
    },
    {
      heading: '다른 외부 앱과 함께 쓰는 것',
      items: [
        '모든 외부 앱이 WorkBench 서버 주소 하나에서 열립니다. 쿠키와 localStorage 이름 앞에 앱 이름을 붙여 다른 앱과 겹치지 않게 하세요(예: luglab_session).',
        "'wb_ext_' 로 시작하는 쿠키 이름은 WorkBench 가 쓰므로 쓸 수 없습니다.",
      ],
    },
    {
      heading: 'WorkBench 쪽 정보',
      items: [
        `WorkBench 입구: ${entry}`,
        '서비스 상태를 개발 중으로 두면 관리자만 열 수 있어, 공개 전 시험에 쓸 수 있습니다.',
      ],
    },
  ];
}

/** 메신저·메일에 붙여 넣을 수 있는 글로 만든다. */
export function developerNotesText(app = {}) {
  const title = String(app.title ?? '').trim();
  const lines = [`[Hi-TESS WorkBench 외부 App 연결 안내]${title ? ` ${title}` : ''}`, ''];
  buildDeveloperNotes(app).forEach((section, index) => {
    lines.push(`${index + 1}. ${section.heading}`);
    section.items.forEach(item => lines.push(`  - ${item}`));
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}
