/**
 * blob 요청의 오류 응답에서 detail 문구를 꺼낸다.
 *
 * ⚠️ axios 는 responseType:'blob' 을 오류 응답에도 적용한다. 그래서 400/403/404 의
 * JSON 본문이 파싱된 객체가 아니라 Blob 으로 오고, error.response.data.detail 은
 * 언제나 undefined 다. 그대로 두면 백엔드가 알려 준 사유('완료된 해석만 리포트를
 * 생성할 수 있습니다', '접근 권한이 없는 작업입니다')가 사용자에게 영영 닿지 않고
 * 늘 같은 일반 문구만 뜬다 — 사용자는 왜 실패했는지 알 방법이 없다.
 */
export async function readBlobErrorDetail(error, fallback) {
  const data = error?.response?.data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (parsed?.detail) return parsed.detail;
    } catch {
      // JSON 이 아니면(프록시 HTML 오류 등) 기본 문구로 떨어진다.
    }
    return fallback;
  }
  return data?.detail || fallback;
}
