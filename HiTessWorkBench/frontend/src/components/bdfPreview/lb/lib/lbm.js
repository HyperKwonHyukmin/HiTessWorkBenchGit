/** model.lbm 읽기(04a Task 3 형식). 블록은 버퍼를 복사하지 않는 TypedArray 보기로 준다(4바이트 정렬). */
const TYPES = { '<i4': Int32Array, '<f4': Float32Array, '|u1': Uint8Array };

export function parseLbm(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== 'LBM1') throw new Error('LBM 형식이 아닙니다');
  const hlen = new DataView(buffer).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hlen)));
  const base = 8 + hlen;
  const blocks = {};
  const width = {};
  for (const [name, meta] of Object.entries(header.blocks || {})) {
    const T = TYPES[meta.dtype];
    if (!T) throw new Error(`LBM 블록 형식 미지원: ${meta.dtype}`);
    const n = meta.count * meta.width;
    const start = base + meta.offset;
    // 정렬이 맞으면 보기로, 아니면(이론상 없음) 복사
    blocks[name] = start % T.BYTES_PER_ELEMENT === 0
      ? new T(buffer, start, n)
      : new T(buffer.slice(start, start + n * T.BYTES_PER_ELEMENT));
    width[name] = meta.width;
  }
  return { header, blocks, width };
}

/**
 * 형식 버전(04c §1) — API(ModelSummary.format_version)가 주면 그 값, 없으면 lbm 머리 version, 그것도 없으면 1.
 */
export function lbmVersion(lbm, summaryVersion = null) {
  const v = Number(summaryVersion ?? lbm?.header?.version ?? 1);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** v2 의 1D 방향 벡터·오프셋 블록(행 수가 beams 와 맞을 때만). 없으면 null. */
export function beamExtras(lbm) {
  const nb = (lbm.blocks.beams?.length || 0) / 4;
  const orient = lbm.blocks.beam_orient;
  const offsets = lbm.blocks.beam_offsets;
  return {
    orient: orient && orient.length === nb * 3 ? orient : null,
    offsets: offsets && offsets.length === nb * 6 ? offsets : null,
  };
}
