import { useEffect, useId, useState } from 'react';

/**
 * 숫자 입력 칸 — 앞자리 0 이 붙지 않는다.
 *
 * ⚠ React 는 type="number" 를 **느슨한 비교**(node.value != value)로 갱신한다.
 *   그래서 0 이 든 칸에 45 를 치면 상태는 45 가 되지만 DOM 은 "045" 그대로 남는다
 *   (Number("045") == 45 이라 React 가 "고칠 게 없다"고 판단한다).
 *   표시 문자열을 직접 들고 앞자리 0 을 즉시 지워야 화면과 값이 어긋나지 않는다.
 *
 * 배치 입력(2단계)과 용접 사양(3단계 과정 2)이 같이 쓴다 — 이 함정을 한 곳에만
 * 두려는 것이다. 각자 type="number" 를 쓰면 같은 버그가 다시 난다.
 *
 * @param {number} [min]  이 값 미만은 되돌린다. 용접 각장처럼 0 이면 0 으로 나누게
 *                        되는 항목에 쓴다(생략하면 하한 없음 — 좌표는 음수가 정상).
 * @param {number} [max]  이 값보다 큰 입력은 blur 시 상한으로 되돌린다.
 */
export default function NumberField({
  label, unit, value, onChange, step = 100, title, min, max, disabled = false,
  error = '',
}) {
  const [draft, setDraft] = useState(String(value ?? 0));
  const errorId = useId();

  useEffect(() => {
    // 외부에서 값이 바뀐 경우(기본값 되돌리기, 회전 후보 적용 등)만 표시를 맞춘다.
    // 사용자가 "-" 나 "1." 을 치는 중간 상태를 덮어쓰지 않도록 숫자로 비교한다.
    if (Number(draft) !== Number(value)) setDraft(String(value ?? 0));
  }, [value]);   // eslint-disable-line react-hooks/exhaustive-deps

  const handle = (raw) => {
    // "045" -> "45", "-007" -> "-7", "0" 과 "0.5" 는 그대로.
    const cleaned = raw.replace(/^(-?)0+(?=\d)/, '$1');
    setDraft(cleaned);
    const next = Number(cleaned);
    if (cleaned.trim() !== '' && Number.isFinite(next)) onChange(next);
  };

  return (
    <label className={`block min-w-0 ${disabled ? 'opacity-60' : ''}`} title={title}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-600 truncate">{label}</span>
        <span className="text-[9px] font-mono text-slate-400 shrink-0">{unit}</span>
      </span>
      <input
        type="number"
        value={draft}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => handle(e.target.value)}
        onBlur={() => {
          // 빈 칸이나 "-" 만 남은 상태로 두면 다음 계산이 NaN 을 먹는다.
          // 하한이 있는 항목은 하한으로 되돌린다 — 0 인 채로 두면 서버가 400 을 낸다.
          const next = Number(draft);
          const valid = draft.trim() !== '' && Number.isFinite(next);
          const floor = min ?? 0;
          const lowerBounded = valid ? (min != null && next < min ? min : next) : floor;
          const safe = max != null && lowerBounded > max ? max : lowerBounded;
          setDraft(String(safe));
          onChange(safe);
        }}
        className={`mt-1 w-full px-2.5 py-1.5 rounded-lg border bg-white text-xs font-mono
                   text-slate-700 focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:cursor-not-allowed
                   ${error
                     ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
                     : 'border-slate-200 focus:border-blue-400 focus:ring-blue-100'}`}
      />
      {error && <span id={errorId} className="mt-1 block text-[10px] font-medium leading-snug text-red-600">{error}</span>}
    </label>
  );
}
