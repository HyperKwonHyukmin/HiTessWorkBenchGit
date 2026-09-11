// DrawingToAnalysis 홍보 영상 — Tip 비트(수작업 스케치 입력) 캡처
// 실행: node scripts/promo/capture-dta-tip.mjs
// 산출: <OUT>/tip/*.webm + <OUT>/tip/marks.json
//
// 이 경로는 아직 PoC 다(치수 자동인식 미구현, 파일명 룩업).
// 영상 자막에서 '개발 중'으로 명시하므로 화면은 있는 그대로 담는다.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const OUT = 'C:/Users/HHI/AppData/Local/Temp/claude/C--Coding-WorkBench/38ff173b-c560-4565-9535-27aa10be87a4/scratchpad/tip';
const APP = 'http://localhost:5174/';
const EMP = 'A476854';
const SKETCH = 'C:/Users/HHI/Desktop/temp/lug_test.png';
const REF_MM = '450';                   // 스케치의 전체 길이 치수

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
p.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0, 140)));
const hold = (ms) => p.waitForTimeout(ms);

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
await p.locator('input').first().fill(EMP);
await hold(700);
await p.getByRole('button', { name: /ACCESS WORKBENCH/i }).click();
await hold(6000);
mark('dashboard');

// ── 2. 명령 팔레트로 DrawingToAnalysis 진입 ──────────────────
await p.keyboard.press('Control+KeyK');
await hold(1200);
await p.keyboard.type('Drawing', { delay: 120 });
await hold(1500);
await p.keyboard.press('Enter');
await hold(4500);
mark('dta_open');

// ── 3. JPG/PNG 탭 ────────────────────────────────────────────
await p.getByRole('button', { name: /JPG\/PNG/ }).click();
await hold(2200);
mark('tab_image');                      // 여기서 Tip 비트 시작

// ── 4. 손그림 업로드 ─────────────────────────────────────────
await p.locator('input[type="file"][accept*="png"]').setInputFiles(SKETCH);
await hold(3500);
mark('sketch_preview');                 // 우측에 스케치 크게 표시
await hold(4000);                       // 스케치를 읽을 시간

// ── 5. 기준 치수 입력 ────────────────────────────────────────
const ref = p.locator('input[type="number"]').filter({ hasNot: p.locator('x') }).first();
await ref.click();
await hold(600);
await p.keyboard.type(REF_MM, { delay: 220 });
await hold(2500);
mark('ref_length');

// ── 6. 변환 ──────────────────────────────────────────────────
await p.getByRole('button', { name: /이미지 모델 변환/ }).click();
mark('convert_start');
await waitConvert();
await hold(2500);
mark('model_ready');
await hold(2000);
await orbit(240, -50);
await hold(1500);
mark('model_orbit_done');
await hold(2500);
mark('end');

fs.writeFileSync(OUT + '/marks.json', JSON.stringify(marks, null, 2));
await ctx.close();
await b.close();
console.log('\nOK');
