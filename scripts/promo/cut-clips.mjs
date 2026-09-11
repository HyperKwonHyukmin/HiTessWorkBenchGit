// marks.json 기준으로 원본 캡처를 비트별 mp4 클립으로 자른다.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const CAP = 'C:/Users/HHI/AppData/Local/Temp/claude/C--Coding-WorkBench/38ff173b-c560-4565-9535-27aa10be87a4/scratchpad/capture';
const DEST = 'C:/Coding/Video/hitess-promo/public';
const src = fs.readdirSync(CAP).find(f => f.endsWith('.webm'));
const marks = JSON.parse(fs.readFileSync(`${CAP}/marks.json`, 'utf-8'));

// [출력명, 시작마커, 끝마커]
const CLIPS = [
  ['dta_catalogue',    'catalogue_open',  'convert_start'],
  ['dta_convert',      'convert_start',   'model_orbit_done'],
  ['dta_params',       'params_shown',    'bc_tab'],
  ['dta_bc',           'bc_tab',          'solve_start'],
  ['dta_solve',        'solve_start',     'result_orbit_done'],
  ['dta_blocksupport', 'bs_preview',      'bs_orbit_done'],
];

const out = {};
for (const [name, a, z] of CLIPS) {
  const s = marks[a], e = marks[z];
  if (s == null || e == null) { console.log(`SKIP ${name} (마커 없음)`); continue; }
  const dur = +(e - s).toFixed(2);
  execFileSync('ffmpeg', [
    '-y', '-v', 'error',
    '-ss', String(s), '-t', String(dur),
    '-i', `${CAP}/${src}`,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-r', '25', '-an',
    `${DEST}/${name}.mp4`,
  ], { stdio: 'inherit' });
  const size = fs.statSync(`${DEST}/${name}.mp4`).size;
  out[name] = { from: a, to: z, start: s, duration: dur, frames25: Math.round(dur * 25) };
  console.log(`${name}.mp4  ${dur}s  ${(size / 1048576).toFixed(1)}MB`);
}
fs.writeFileSync(`${CAP}/clips.json`, JSON.stringify(out, null, 2), 'utf-8');
console.log('\n=== clips.json 기록 완료 ===');
