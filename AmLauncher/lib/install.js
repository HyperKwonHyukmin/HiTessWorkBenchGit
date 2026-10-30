// 내려받기 · sha256 확인 · zip 풀기 · Studio 설치 · 결과 폴더 받기.
//
// WorkBench electron/index.js 에서 옮김(사본 — 나중에 공용 모듈로 합칠 대상):
//   downloadToFile        ← index.js downloadToFile (진행률은 mainWindow 대신 onProgress 콜백)
//   sha256OfFile          ← index.js sha256OfFile
//   extractZip            ← index.js extractZipWithTar (PowerShell Expand-Archive)
//   readJsonFolderRecursive ← index.js readJsonFolderRecursive
//   installViewer         ← index.js ipcMain "viewer:install" + 페이지(HiTessModelBuilder.jsx)의 manifest 버전 비교
//   fetchResultDir        ← index.js ipcMain "viewer:fetchResultDir"
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { net } = require("electron");

// Electron net 모듈 기반 다운로드 (Chromium 네트워크 스택 — 시스템 프록시 자동 적용,
// FastAPI/uvicorn keep-alive/응답 종료 비표준에도 관대함)
function downloadToFile(url, destPath, { headers = {}, onProgress = null, timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(destPath);
    let settled = false;
    const settle = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg); } };

    const request = net.request({ url, method: "GET", redirect: "follow", useSessionCookies: false });
    for (const [k, v] of Object.entries(headers || {})) {
      try { request.setHeader(k, String(v)); } catch { /* 잘못된 헤더는 건너뜀 */ }
    }

    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        stream.destroy();
        try { fs.unlinkSync(destPath); } catch {}
        settle(reject, new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const total = parseInt(response.headers["content-length"] || "0", 10);
      let received = 0;
      response.on("data", (chunk) => {
        received += chunk.length;
        stream.write(chunk);
        if (onProgress) onProgress({ received, total });
      });
      response.on("end", () => {
        stream.end();
        stream.on("finish", () => settle(resolve, { received, total }));
        stream.on("error", (e) => settle(reject, e));
      });
      response.on("error", (e) => { stream.destroy(); settle(reject, e instanceof Error ? e : new Error(String(e))); });
      response.on("aborted", () => { stream.destroy(); settle(reject, new Error("response aborted")); });
    });
    request.on("error", (e) => { stream.destroy(); settle(reject, e instanceof Error ? e : new Error(String(e))); });
    request.on("abort", () => { stream.destroy(); settle(reject, new Error("request aborted (시간 초과)")); });
    request.end();

    const timer = setTimeout(() => { if (!settled) { try { request.abort(); } catch {} } }, timeoutMs);
  });
}

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(filePath);
    s.on("data", (chunk) => h.update(chunk));
    s.on("end", () => resolve(h.digest("hex")));
    s.on("error", reject);
  });
}

// Windows 내장 PowerShell Expand-Archive 로 zip 풀기 (외부 의존성 0).
// Windows 의 tar.exe(bsdtar) 는 'C:' 를 원격 호스트로 오인하는 이슈가 있어 PowerShell 사용.
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const esc = (s) => String(s).replace(/'/g, "''");
    const cmd = `Expand-Archive -LiteralPath '${esc(zipPath)}' -DestinationPath '${esc(destDir)}' -Force`;
    const proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd],
      { windowsHide: true },
    );
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Expand-Archive 종료 코드 ${code}: ${stderr.trim()}`));
    });
    proc.on("error", reject);
  });
}

// 폴더(재귀)에서 .json 파일을 모두 읽어 { folderPath, files:[{name, content}] } 로 반환
async function readJsonFolderRecursive(folderPath) {
  const files = [];
  const stack = [folderPath];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    const reads = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase().endsWith(".json")) {
        reads.push(
          fs.promises.readFile(full, "utf-8")
            .then((content) => files.push({ name: entry.name, content }))
            .catch(() => { /* 개별 파일 오류는 건너뜀 */ }),
        );
      }
    }
    await Promise.all(reads);
  }
  return { folderPath, files };
}

function safeViewerDir(viewersRoot, viewerId) {
  // viewerId 는 a-z0-9-_ 만 허용 — 디렉터리 탈출 방지
  const safe = String(viewerId).replace(/[^a-z0-9_-]/gi, "");
  return path.join(viewersRoot, safe);
}

function readInstalledManifest(dir) {
  try {
    const manifestPath = path.join(dir, "manifest.json");
    const indexPath = path.join(dir, "index.html");
    if (!fs.existsSync(manifestPath) || !fs.existsSync(indexPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Studio 확인·설치. 서버 manifest 버전과 설치본 버전이 다르거나 설치본이 없으면 내려받는다.
 * 우선순위: UNC 직접 복사(회사 DRM/프록시가 HTTP 응답을 변조하는 환경 우회) → 실패 시 HTTP.
 * @returns {Promise<{dir:string, manifest:object, installed:boolean, source:string|null}>}
 */
async function installViewer({ client, viewerId, viewersRoot, tempDir, log, onProgress }) {
  const dir = safeViewerDir(viewersRoot, viewerId);
  const meta = await client.getJson(`/api/viewers/manifest/${encodeURIComponent(viewerId)}`);
  const serverVer = meta?.manifest?.version ?? null;
  const local = readInstalledManifest(dir);
  const localVer = local?.version ?? null;
  log.info(`Studio ${viewerId}: 서버 v${serverVer} / 설치본 v${localVer ?? "없음"}`);

  if (local && (!serverVer || serverVer === localVer)) {
    return { dir, manifest: local, installed: false, source: null };
  }

  const tmpZip = path.join(tempDir, `${viewerId}-${Date.now()}.zip`);
  let usedSource = null;
  let lastErr = null;
  try {
    if (meta.uncPath) {
      try {
        onProgress?.({ received: 0, total: meta.size || 0, note: "UNC 복사" });
        await fs.promises.copyFile(meta.uncPath, tmpZip);
        usedSource = "unc";
      } catch (e) {
        lastErr = e;
        log.warn(`UNC 복사 실패, HTTP 로 넘어감: ${e.message}`);
      }
    }
    if (!usedSource && meta.downloadUrl) {
      try {
        await downloadToFile(client.url(meta.downloadUrl), tmpZip, { onProgress });
        usedSource = "http";
      } catch (e) {
        lastErr = e;
      }
    }
    if (!usedSource) throw new Error(`Studio 내려받기 실패 (UNC/HTTP 모두): ${lastErr?.message || "원인 불명"}`);

    if (meta.sha256) {
      const actual = await sha256OfFile(tmpZip);
      if (actual.toLowerCase() !== String(meta.sha256).toLowerCase()) {
        throw new Error(
          `SHA256 불일치 — 서버 ${meta.sha256}, 받은 파일 ${actual} (경로: ${usedSource}). `
          + "회사 DRM/프록시가 내려받는 도중 zip 을 바꾼 것으로 보입니다.",
        );
      }
    }

    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await extractZip(tmpZip, dir);

    const manifest = readInstalledManifest(dir);
    if (!manifest) throw new Error("압축을 푼 뒤 manifest.json 또는 index.html 이 없습니다.");
    log.info(`Studio ${viewerId} v${manifest.version} 설치 완료 (${usedSource})`);
    return { dir, manifest, installed: true, source: usedSource };
  } finally {
    try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch {}
  }
}

/**
 * 서버 결과 폴더(output_dir)를 result-zip 으로 받아 resultsRoot\<jobId> 에 푼다.
 * Studio 의 initialFolder 로 쓸 로컬 경로를 반환한다.
 */
async function fetchResultDir({ client, outputDir, jobId, resultsRoot, tempDir, log, onProgress }) {
  const tmpZip = path.join(tempDir, `result-${jobId}-${Date.now()}.zip`);
  const targetDir = path.join(resultsRoot, String(jobId));
  const params = new URLSearchParams({ output_dir: outputDir });
  const url = client.url(`/api/analysis/modelflow/result-zip?${params}`);
  try {
    try {
      await downloadToFile(url, tmpZip, { headers: client.authHeaders(), onProgress });
    } catch (e) {
      if (!/HTTP 401/.test(e.message)) throw e;
      log.warn("result-zip 401 → 다시 로그인 후 재시도");
      await client.login();
      await downloadToFile(url, tmpZip, { headers: client.authHeaders(), onProgress });
    }
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });
    await extractZip(tmpZip, targetDir);
    log.info(`결과 폴더 받음: ${targetDir}`);
    return targetDir;
  } finally {
    try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch {}
  }
}

module.exports = {
  downloadToFile,
  sha256OfFile,
  extractZip,
  readJsonFolderRecursive,
  installViewer,
  fetchResultDir,
  safeViewerDir,
};
