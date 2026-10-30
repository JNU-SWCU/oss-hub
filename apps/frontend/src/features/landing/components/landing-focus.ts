import type { CosmosFocus } from '@/features/landing/cosmos';

export const FOCUS_ROOT_MARGIN = '-40% 0px -40% 0px';

const FOCUS_MODES: readonly CosmosFocus[] = [
  'hero',
  'programs',
  'flow',
  'activity',
];

export function isCosmosFocus(value: unknown): value is CosmosFocus {
  return FOCUS_MODES.some((mode) => mode === value);
}

export function observeChapterFocus(
  targets: ReadonlyMap<Element, CosmosFocus>,
  onChange: (focus: CosmosFocus) => void,
): () => void {
  const observer = new IntersectionObserver(
    (entries) => {
      let next: CosmosFocus | null = null;
      let bestRatio = -1;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const focus = targets.get(entry.target);
        if (!focus || entry.intersectionRatio < bestRatio) continue;
        bestRatio = entry.intersectionRatio;
        next = focus;
      }
      if (next !== null) onChange(next);
    },
    { rootMargin: FOCUS_ROOT_MARGIN, threshold: 0 },
  );
  for (const target of targets.keys()) observer.observe(target);
  return () => observer.disconnect();
}
