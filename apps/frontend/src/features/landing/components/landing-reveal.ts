import { useCallback, useEffect, useRef } from 'react';
import type { RefCallback } from 'react';

const REVEAL_THRESHOLD = 0.15;

export function useRevealOnce(): RefCallback<HTMLElement> {
  const elements = useRef(new Set<HTMLElement>());

  const register = useCallback<RefCallback<HTMLElement>>((element) => {
    if (!element) return;
    const registry = elements.current;
    registry.add(element);
    return () => {
      registry.delete(element);
    };
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-reveal', 'shown');
          observer.unobserve(entry.target);
        }
      },
      { threshold: REVEAL_THRESHOLD },
    );
    for (const element of elements.current) {
      element.setAttribute('data-reveal', 'armed');
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return register;
}
