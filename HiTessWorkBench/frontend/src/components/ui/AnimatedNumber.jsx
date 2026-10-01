import React, { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { EASE_OUT } from './motion';

/**
 * 숫자가 이전 값에서 새 값으로 올라간다(기본 0.5s). 처음 나타날 때는 0 에서 시작한다.
 * 동작 줄이기면 바로 새 값. 숫자가 아니면(문자열·노드) 그대로 보여 준다.
 *
 * @param {number} value
 * @param {number} [digits=0]   소수 자릿수(최대)
 * @param {boolean} [locale=false]  천 단위 구분(ko-KR)
 * @param {boolean} [fromZero=true] 첫 표시를 0 에서 올릴지
 */
export default function AnimatedNumber({ value, digits = 0, locale = false, fixed = false, fromZero = true, duration = 0.5 }) {
  const reduce = useReducedMotion();
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const target = numeric ? value : 0;
  const start = reduce || !fromZero ? target : 0;
  const [shown, setShown] = useState(start);
  const fromRef = useRef(start);

  useEffect(() => {
    if (!numeric) return undefined;
    if (reduce) { fromRef.current = target; setShown(target); return undefined; }
    const controls = animate(fromRef.current, target, {
      duration,
      ease: EASE_OUT,
      onUpdate: setShown,
      onComplete: () => setShown(target), // 끝값을 정확히(부동소수 오차 없이)
    });
    fromRef.current = target;
    return () => controls.stop();
  }, [target, numeric, reduce, duration]);

  if (!numeric) return <>{value}</>;
  // 표기는 호출하는 화면의 기존 형식을 따른다 — digits 는 그 화면이 쓰던 소수 자릿수(toFixed)와 같게 넘길 것.
  // fixed: 끝자리 0 까지 유지(toLocaleString 으로 '1.500' 처럼 쓰던 화면용)
  if (locale) return <>{shown.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: fixed ? digits : 0 })}</>;
  return <>{shown.toFixed(digits)}</>;
}
