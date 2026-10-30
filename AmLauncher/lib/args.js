// 명령줄 인자 해석 — Electron 의존성 없음(단위 테스트·second-instance 공용).
//
// 규약: HiTessMBLauncher.exe --server=<http://host:9091> --employee <사번> --job <job_id>
//                            [--hull-no <호선>] [--smoke]
// 모르는 인자(Chromium 이 붙이는 스위치, 개발 실행의 '.' 등)는 무시한다.
//
// ⚠ Electron 은 'http://…' 처럼 URL 모양인 인자 **뒤에** 다른 인자가 오면 JS 를 한 줄도 실행하지 않고
//   종료한다(Windows, 프로토콜 처리기 주입 방지 — 종료 코드 -1, 로그 없음. 2026-10-30 실측).
//   그래서 호출하는 쪽은 아래 중 하나로 넘겨야 한다:
//     --server=http://host:9091   (권장 — '=' 로 붙이면 URL 로 보지 않는다)
//     --server host:9091          (스킴 생략 — 숫자로 시작하는 IP 일 때만 안전, http:// 를 붙여 쓴다)
//     --server http://host:9091 를 맨 마지막 인자로
"use strict";

const EMPLOYEE_RE = /^[A-Za-z]\d{5,7}$/;
// job_id 는 서버가 만든 uuid. 폴더 이름으로도 쓰므로 안전한 글자만 허용한다.
const JOB_RE = /^[A-Za-z0-9_-]{1,80}$/;
const HULL_RE = /^[A-Za-z0-9_-]{1,20}$/;

function readValue(argv, i, name) {
  const token = argv[i];
  const eq = token.indexOf("=");
  if (eq > 0) return { value: token.slice(eq + 1), next: i };
  const v = argv[i + 1];
  if (v === undefined || String(v).startsWith("--")) {
    throw new Error(`${name} 값이 없습니다.`);
  }
  return { value: v, next: i + 1 };
}

/**
 * @param {string[]} argv process.argv 또는 second-instance 의 commandLine
 * @returns {{server:string, employee:string, job:string, hullNo:string|null, smoke:boolean}}
 */
function parseArgs(argv) {
  const out = { server: "", employee: "", job: "", hullNo: null, smoke: false };
  const list = Array.isArray(argv) ? argv.map(String) : [];
  for (let i = 0; i < list.length; i++) {
    const token = list[i];
    const key = token.split("=")[0].toLowerCase();
    if (key === "--smoke") { out.smoke = true; continue; }
    if (key === "--server" || key === "--employee" || key === "--job" || key === "--hull-no") {
      const { value, next } = readValue(list, i, key);
      i = next;
      if (key === "--server") out.server = value.trim();
      else if (key === "--employee") out.employee = value.trim().toUpperCase();
      else if (key === "--job") out.job = value.trim();
      else out.hullNo = value.trim().toUpperCase() || null;
    }
  }

  if (!out.server) throw new Error("--server 가 없습니다.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(out.server)) out.server = `http://${out.server}`;
  let url;
  try { url = new URL(out.server); } catch { throw new Error(`--server 주소 형식이 잘못됐습니다: ${out.server}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("--server 는 http:// 또는 https:// 로 시작해야 합니다.");
  }
  out.server = `${url.protocol}//${url.host}`;

  if (!out.employee) throw new Error("--employee 가 없습니다.");
  if (!EMPLOYEE_RE.test(out.employee)) throw new Error(`사번 형식이 잘못됐습니다: ${out.employee}`);
  if (!out.job) throw new Error("--job 이 없습니다.");
  if (!JOB_RE.test(out.job)) throw new Error(`job_id 형식이 잘못됐습니다: ${out.job}`);
  if (out.hullNo && !HULL_RE.test(out.hullNo)) throw new Error(`호선 형식이 잘못됐습니다: ${out.hullNo}`);
  return out;
}

module.exports = { parseArgs };
