// 로그인 없이 여는 서버 공개 페이지(/history · /newsletter 등)의 주소 — 브라우저에 붙여 넣거나 메일에 적을 때 쓴다.
//
// 앱은 서버와 https(인증서 지문 고정)로 말하지만, 그 인증서는 회사 브라우저가 모르는 자체 인증서라
// 같은 주소를 브라우저로 열면 경고가 뜬다. 서버는 9091 한 포트에서 평문과 HTTPS 를 함께 받으므로
// (백엔드 app/services/port_mux.py) 남에게 줄 주소는 http://…:9091 로 만든다. 9443 은 HTTPS 전용이라 9091 로 옮긴다.
// 그 밖의 주소(개발 PC http://…:9091, 직접 넣은 주소)는 그대로 둔다.
export function publicPageUrl(apiBaseUrl, path) {
  const base = String(apiBaseUrl || '').trim().replace(/\/+$/, '');
  const tail = `/${String(path || '').replace(/^\/+/, '')}`;
  const m = /^https:\/\/([^/:]+):(9091|9443)$/i.exec(base);
  return (m ? `http://${m[1]}:9091` : base) + tail;
}
