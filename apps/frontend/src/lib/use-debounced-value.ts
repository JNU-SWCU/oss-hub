'use client';

import { useEffect, useState } from 'react';

/**
 * `value`가 `delayMs` 동안 더 바뀌지 않아야 그 값을 돌려준다. 값이 다시 바뀌면
 * 대기 중이던 타이머를 지우고 새로 잰다 — 연속 입력 중에는 항상 이전 debounce
 * 값을 유지하다가, 입력이 멈춘 뒤에만 최신값으로 넘어간다.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
