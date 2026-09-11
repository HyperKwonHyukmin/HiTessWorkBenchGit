// DrawingToAnalysis 홍보 영상 — 본편 캡처
// 실행: node scripts/promo/capture-dta.mjs
// 산출: <OUT>/capture/*.webm  +  <OUT>/capture/marks.json
//
// marks.json 은 각 비트의 시작 시각(초)을 담는다. Remotion captures.ts 의
// startFrom(프레임 트림) 을 눈대중이 아니라 계산으로 채우기 위한 것.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const OUT = 'C:/Users/HHI/AppData/Local/Temp/claude/C--Coding-WorkBench/38ff173b-c560-4565-9535-27aa10be87a4/scratchpad/capture';
const APP = 'http://localhost:5174/';
const EMP = 'A476854';
const FZ = '245166';           // 도면 안전하중 25,000 kg
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
});
const T0 = Date.now();
const marks = {};
const mark = (k) => { marks[k] = +((Date.now() - T0) / 1000).toFixed(2); console.log(`  ${marks[k]}s  ${k}`); };

const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0, 120)));
const hold = (ms) => p.waitForTimeout(ms);

// 캔버스 궤도 회전 (영상용)
const orbit = async (dx = 220, dy = -40, steps = 40) => {
  const c = await p.locator('canvas').first().boundingBox();
  const cx = c.x + c.width * 0.55, cy = c.y + c.height * 0.5;
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await p.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps);
    await p.waitForTimeout(16);
  }
  await p.mouse.up();
};

const waitConvert = async () => {
  for (let i = 0; i < 150; i++) {
    await hold(1000);
    if (!/변환 중\.\.\./.test(await p.locator('body').innerText())) return true;
  }
  return false;
};

// ── 1. 로그인 ────────────────────────────────────────────────
await p.goto(APP, { waitUntil: 'networkidle' });
await hold(4000);
mark('login_screen');
await p.locator('input').first().fill(EMP);
await hold(900);
await p.getByRole('button', { name: /ACCESS WORKBENCH/i }).click();
await hold(6000);
mark('dashboard');

// ── 2. 명령 팔레트로 DrawingToAnalysis 진입 ──────────────────
await p.keyboard.press('Control+KeyK');
await hold(1400);
mark('palette_open');
await p.keyboard.type('Drawing', { delay: 130 });
await hold(1800);
await p.keyboard.press('Enter');
await hold(4500);
mark('dta_open');
await hold(1500);

// ── 3. 카탈로그 → LUG 도면 ───────────────────────────────────
await p.getByRole('button', { name: /카탈로그 열기/ }).click();
await hold(2800);
mark('catalogue_open');
await hold(1800);
await p.getByText('Lug', { exact: true }).first().click();
await hold(3500);
mark('drawing_preview');
await hold(4500);                       // 도면 치수를 읽을 시간

// ── 4. 변환 ──────────────────────────────────────────────────
await p.getByRole('button', { name: /이 도면으로 변환 시작/ }).click();
mark('convert_start');
await waitConvert();
await hold(2500);
mark('model_ready');
await hold(2000);
await orbit(240, -50);                  // 3D 모델 회전
await hold(1200);
mark('model_orbit_done');

// ── 5. 설계 파라미터 (치수 일치 컷) ──────────────────────────
await p.getByText('설계 파라미터', { exact: false }).first().click();
await hold(1500);
mark('params_shown');
await hold(5000);                       // 25.0 / 270.0 / 150.0 / 80.0 / 61.0 / 120.0

// ── 6. 하중·경계조건 ─────────────────────────────────────────
await p.getByText('하중/경계조건', { exact: false }).first().click();
await hold(2000);
mark('bc_tab');
await p.getByRole('button', { name: /Lug Hole RBE 생성/ }).click();
await hold(3000);
mark('rbe_created');
await hold(1500);

await p.getByRole('button', { name: /경계조건 추가/ }).first().click();
await hold(1500);
mark('bc_mode');
const bx = await p.locator('canvas').first().boundingBox();
await p.keyboard.down('Shift');
await p.mouse.move(bx.x + bx.width * 0.28, bx.y + bx.height * 0.12);
await p.mouse.down();
await p.mouse.move(bx.x + bx.width * 0.42, bx.y + bx.height * 0.92, { steps: 40 });
await p.mouse.up();
await p.keyboard.up('Shift');
await hold(2000);
mark('bc_selected');
for (const d of ['TX', 'TY', 'TZ', 'RX', 'RY', 'RZ']) {
  const el = p.getByText(d, { exact: true }).first();
  if (await el.count()) { await el.click().catch(() => {}); await hold(220); }
}
await hold(1200);
await p.getByRole('button', { name: /^경계조건 추가$/ }).last().click();
await hold(2500);
mark('bc_done');

await p.getByRole('button', { name: /하중 추가/ }).first().click();
await hold(1800);
const cb = await p.locator('canvas').first().boundingBox();
await p.mouse.click(cb.x + cb.width * 0.555, cb.y + cb.height * 0.535);
await hold(2000);
mark('load_node_picked');
await p.locator('input[type=text]:visible').nth(2).fill(FZ);
await hold(1500);
await p.getByRole('button', { name: /^하중 추가$/ }).last().click();
await hold(2500);
mark('load_done');

// ── 7. Nastran 해석 ─────────────────────────────────────────
await p.getByRole('button', { name: /구조 해석 실행 \(Nastran\)/ }).click();
mark('solve_start');
for (let i = 0; i < 200; i++) {
  await hold(1500);
  const tx = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  if (/해석 완료|Nastran 구조 해석이 완료/.test(tx) && !/진행 중/.test(tx)) break;
  if (!/진행 중/.test(tx) && /\|U\| \(mm\)/.test(tx)) break;
}
await hold(3000);
mark('solve_done');
await hold(3000);
await orbit(200, -30);                  // 변위 컨투어 회전
await hold(2500);
mark('result_orbit_done');

// ── 8. Block Support ────────────────────────────────────────
await p.getByRole('button', { name: /^초기화$/ }).first().click();
await hold(3000);
mark('reset');
await p.getByRole('button', { name: /카탈로그 열기/ }).click();
await hold(2500);
await p.getByText('Block Support', { exact: true }).first().click();
await hold(3500);
mark('bs_preview');
await hold(3500);
await p.getByRole('button', { name: /이 도면으로 변환 시작/ }).click();
mark('bs_convert_start');
await waitConvert();
await hold(2500);
mark('bs_model_ready');
await hold(2000);
await orbit(240, -40);
await hold(2000);
mark('bs_orbit_done');

marks._total = +((Date.now() - T0) / 1000).toFixed(2);
await ctx.close();
await b.close();
fs.writeFileSync(`${OUT}/marks.json`, JSON.stringify(marks, null, 2), 'utf-8');
console.log('\n=== 촬영 완료. 총', marks._total, 's ===');
