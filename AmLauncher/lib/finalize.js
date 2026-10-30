// 편집 확정(Studio "모델 저장") — WorkBench 에서는 메인 창 페이지가 하던 일을 실행기 main 에서 직접 한다.
//
// WorkBench frontend/src/pages/analysis/HiTessModelBuilder.jsx 에서 옮김:
//   startFinalize   ← useEffect 'modelflow:finalize-edit-request' 리스너
//                     (수정 0건 → discard-edit / 있으면 upload-edit → startApplyEditJob = POST apply-edit)
//   pollApplyEdit   ← pollEditJobInBackground (1.5초 status 폴링)
//   fetchEditStatus ← refreshEditStatus (GET edit-status)
//   downloadServerFile ← 페이지의 BDF 받기(GET /api/download?filepath=)
// Studio 에는 apply-edit 작업이 '시작됐다'는 것까지만 회신한다(수 분 걸리는 체인을 Studio 가 기다리지 않게) —
// WorkBench 와 같은 설계. 그 뒤 진행·결과는 실행기 진행 창이 보여 준다.
"use strict";

const fs = require("fs");
const path = require("path");
const { readBackendError } = require("./server-client");

function isInside(baseAbs, targetAbs) {
  const rel = path.relative(baseAbs, targetAbs);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * @returns {Promise<{ok:true, mode:'discard'} | {ok:true, mode:'apply', jobId:string} | {ok:false, error:string}>}
 */
async function startFinalize({ client, localDir, outputDir, folderPath, editFileName, log }) {
  if (!folderPath) return { ok: false, error: "folderPath 누락" };
  if (!outputDir) return { ok: false, error: "서버 결과 폴더(output_dir)를 모릅니다. 실행기를 다시 실행하세요." };
  const baseAbs = path.resolve(folderPath);
  // 실행기가 받은 결과 폴더(로컬 추출본)에서 저장한 편집만 서버 output_dir 로 올릴 수 있다.
  // 다른 폴더를 '폴더 열기' 로 연 뒤 저장하면 어느 서버 모델의 편집인지 알 수 없다.
  if (!localDir || path.resolve(localDir).toLowerCase() !== baseAbs.toLowerCase()) {
    return { ok: false, error: "실행기가 받은 결과 폴더에서 연 모델만 저장할 수 있습니다. Studio 를 다시 여세요." };
  }

  if (!editFileName) {
    // 수정 내역 0건 = 원본 그대로. 이전 회차의 *_edit.json / edited/ 가 남아 있으면
    // 옛 편집본을 계속 쓰므로 서버에서 걷어낸다(WorkBench 와 같음).
    try {
      await client.postJson("/api/analysis/modelflow/discard-edit", { output_dir: outputDir });
    } catch (e) {
      return { ok: false, error: `이전 편집본 정리 실패: ${e.message}` };
    }
    log.info("수정 0건 저장 → discard-edit 완료");
    return { ok: true, mode: "discard" };
  }

  const editAbs = path.resolve(baseAbs, editFileName);
  if (!isInside(baseAbs, editAbs)) return { ok: false, error: "경로 탈출 시도 차단" };
  if (!fs.existsSync(editAbs)) return { ok: false, error: `_edit.json 파일이 없습니다: ${editFileName}` };

  // 1) 로컬 *_edit.json → 서버 output_dir 로 업로드 (apply-edit-intent 는 서버 로컬 파일을 읽는다)
  try {
    const data = await fs.promises.readFile(editAbs);
    const res = await client.fetchAuthed("/api/analysis/modelflow/upload-edit", () => {
      const fd = new FormData();
      fd.append("target_dir", outputDir);
      fd.append("file", new Blob([data], { type: "application/json" }), path.basename(editFileName));
      return { method: "POST", body: fd };
    });
    if (!res.ok) {
      const detail = await readBackendError(res);
      throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
  } catch (e) {
    return { ok: false, error: `*_edit.json 업로드 실패: ${e.message}` };
  }

  // 2) apply-edit 작업 시작 → job_id 즉시 회수
  try {
    const body = await client.postJson("/api/analysis/modelflow/apply-edit", { output_dir: outputDir, strict: false });
    const jobId = body?.job_id;
    if (!jobId) return { ok: false, error: "편집 적용 요청 응답에 job_id 가 없습니다." };
    log.info(`편집 적용 시작: ${editFileName} → job ${jobId}`);
    return { ok: true, mode: "apply", jobId };
  } catch (e) {
    return { ok: false, error: `편집 적용 요청 실패: ${e.message}` };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** apply-edit 작업 상태를 끝날 때까지 1.5초마다 본다. 최대 15분. */
async function pollApplyEdit({ client, jobId, onStatus }) {
  for (let i = 0; i < 600; i++) {
    await sleep(1500);
    let sd;
    try {
      sd = await client.getJson(`/api/analysis/status/${encodeURIComponent(jobId)}`);
    } catch {
      continue;
    }
    onStatus?.(sd);
    if (sd.status === "Success" || sd.status === "Failed" || sd.status === "Cancelled") return sd;
  }
  return { status: "Failed", message: "편집 적용 시간 초과 (15분)" };
}

async function fetchEditStatus({ client, outputDir }) {
  return client.getJson(`/api/analysis/modelflow/edit-status?output_dir=${encodeURIComponent(outputDir)}`);
}

/** 서버 파일(userConnection 하위)을 GET /api/download 로 받아 destPath 에 쓴다. */
async function downloadServerFile({ client, remotePath, destPath }) {
  const res = await client.fetchAuthed(`/api/download?filepath=${encodeURIComponent(remotePath)}`, { method: "GET" });
  if (!res.ok) {
    const detail = await readBackendError(res);
    throw new Error(`HTTP ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  await fs.promises.writeFile(destPath, buf);
  return { size: buf.length };
}

module.exports = { startFinalize, pollApplyEdit, fetchEditStatus, downloadServerFile };
