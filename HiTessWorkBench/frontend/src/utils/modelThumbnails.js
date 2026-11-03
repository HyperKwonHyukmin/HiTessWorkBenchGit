/**
 * 대시보드 '모델 벽' 썸네일 — 서버는 BDF 를 model.lbm 으로 바꿔 주기만 하고, 그림은 브라우저가 그린다.
 *
 * 서버가 그리면(matplotlib 1장 1~2초) 해석 작업과 CPU 를 다툰다. 그래서 숨긴 칸에 BDF 미리보기 엔진을
 * 한 번에 하나만 띄워 찍고 바로 닫는다. 결과는 IndexedDB 에 남겨 다음부터는 서버에 묻지 않는다.
 * 작업 번호가 서버마다 달라 저장 키에 서버 주소를 넣는다.
 */

const THUMB_WIDTH = 420;
const THUMB_HEIGHT = 262;
// 크게 그린 뒤 가운데만 잘라 낸다 — 엔진의 전체 보기는 여백이 크고 왼쪽 아래에 축 표시가 있다.
const RENDER_SCALE = 1.7;
const JPEG_QUALITY = 0.82;
const EDGE_LIMIT = 200_000;
const DB_NAME = 'workbench-model-thumbnails';
const STORE = 'thumbs';
const MODEL_KEYS = [['result_info', 'bdf'], ['result_info', 'bdf_path'], ['input_info', 'bdf_model'], ['input_info', 'bdf'], ['input_info', 'bdf_path']];

/** 기록의 모델 BDF 경로(백엔드 bdf_preview.find_model_bdf 와 같은 키). 없으면 ''. */
function modelBdfPath(project) {
  for (const [source, key] of MODEL_KEYS) {
    const value = String(project?.[source]?.[key] ?? '');
    if (/\.(bdf|dat|nas)$/i.test(value)) return value;
  }
  return '';
}

/** 3D 로 볼 BDF 가 기록에 있는가. */
export function hasModelBdf(project) {
  if (!project || project.status !== 'Success' || project.files_available === false) return false;
  return modelBdfPath(project) !== '';
}

/** 묶인 실행 줄 중 모델이 있는 것만 최신순으로 count 개. 같은 앱·같은 BDF 이름은 최신 1칸 — 벽이 같은 그림으로 차지 않게. */
export function modelWallGroups(groups, count) {
  const seen = new Set();
  const wall = [];
  for (const group of groups ?? []) {
    if (wall.length >= count) break;
    if (!hasModelBdf(group.head)) continue;
    const key = `${group.head.program_name}|${modelBdfPath(group.head).split(/[\\/]/).pop().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wall.push(group);
  }
  return wall;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStored(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeStored(key, value) {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
  } catch { /* 저장 못 해도 이번 화면에는 보인다 */ }
}

const nextFrame = () => new Promise((resolve) => { requestAnimationFrame(resolve); });

async function renderThumbnail(analysisId) {
  const [{ getAnalysisModelPreview }, lbmLib, { buildGeometry }, { computeGroups }, { classifyNodes }, { listRigids }, { planSections }, { createViewerEngine }] = await Promise.all([
    import('../api/analysis'),
    import('../components/bdfPreview/lb/lib/lbm.js'),
    import('../components/bdfPreview/lb/lib/modelGeometry.js'),
    import('../components/bdfPreview/lb/lib/modelGroups.js'),
    import('../components/bdfPreview/lb/lib/nodeCheck.js'),
    import('../components/bdfPreview/lb/lib/modelIndex.js'),
    import('../components/bdfPreview/lb/lib/sectionPlan.js'),
    import('../components/bdfPreview/lb/components/viewer/viewerEngine.js'),
  ]);
  const { data } = await getAnalysisModelPreview(analysisId);
  const lbm = lbmLib.parseLbm(data);
  const geometry = buildGeometry(lbm);
  const { orient, offsets } = lbmLib.beamExtras(lbm);

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  const renderWidth = Math.round(THUMB_WIDTH * RENDER_SCALE);
  const renderHeight = Math.round(THUMB_HEIGHT * RENDER_SCALE);
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${renderWidth}px;height:${renderHeight}px;`;
  document.body.appendChild(host);
  let engine = null;
  try {
    engine = await createViewerEngine(host);
    engine.setModel(geometry, {
      edges: geometry.total <= EDGE_LIMIT,
      extras: {
        blocks: lbm.blocks, groups: computeGroups(lbm), check: classifyNodes(lbm), rigids: listRigids(lbm),
        plan: planSections(lbm, geometry), orient, offsets,
      },
    });
    engine.setMarkers({ rbe2: false, rbe3: false, conm2: false, spc: false });
    engine.setColorMode('section');
    await nextFrame();
    engine.fit();
    // 엔진은 preserveDrawingBuffer 없이 온디맨드로 그린다. 엔진의 프레임 뒤에 예약한 이 콜백은 같은 프레임이라
    // 그림이 아직 지워지지 않았다.
    await nextFrame();
    const source = host.querySelector('canvas');
    const crop = document.createElement('canvas');
    crop.width = THUMB_WIDTH;
    crop.height = THUMB_HEIGHT;
    const sw = source.width / RENDER_SCALE;
    const sh = source.height / RENDER_SCALE;
    crop.getContext('2d').drawImage(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    return crop.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    engine?.dispose();
    host.remove();
  }
}

const memory = new Map();
let queue = Promise.resolve();

/** 썸네일 data URL. 못 그리면 null. 실패는 기억하지 않아 서버가 돌아오면 다음 요청이 다시 그린다. */
export function requestModelThumbnail(analysisId, serverKey, render = renderThumbnail) {
  const key = `${serverKey}|${analysisId}`;
  if (memory.has(key)) return memory.get(key);
  const job = (async () => {
    const stored = await readStored(key);
    if (stored) return stored;
    const run = queue.then(() => render(analysisId));
    queue = run.catch(() => {});
    const url = await run;
    await writeStored(key, url);
    return url;
  })().catch(() => {
    memory.delete(key);
    return null;
  });
  memory.set(key, job);
  return job;
}
