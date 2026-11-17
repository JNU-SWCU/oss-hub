'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

interface ClampedText<T extends HTMLElement> {
  readonly ref: RefObject<T | null>;
  readonly expanded: boolean;
  readonly overflowing: boolean;
  readonly toggle: () => void;
}

export function useClampedText<T extends HTMLElement>(
  text: string,
): ClampedText<T> {
  const ref = useRef<T>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const content = ref.current;
    if (content === null || expanded) return;
    const measure = (): void => {
      setOverflowing(content.scrollHeight > content.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [text, expanded]);

  return {
    ref,
    expanded,
    overflowing,
    toggle: () => setExpanded((current) => !current),
  };
}
