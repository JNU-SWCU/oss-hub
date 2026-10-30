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

interface BandEntry {
  readonly ratio: number;
  readonly order: number;
}

function pick(
  pool: readonly Element[],
  score: (element: Element) => number,
): Element | null {
  let next: Element | null = null;
  let best = -1;
  for (const element of pool) {
    const wrapsAnother = pool.some(
      (other) => other !== element && element.contains(other),
    );
    if (wrapsAnother) continue;
    const value = score(element);
    if (value < best) continue;
    best = value;
    next = element;
  }
  return next;
}

export function observeChapterFocus(
  targets: ReadonlyMap<Element, CosmosFocus>,
  onChange: (focus: CosmosFocus) => void,
): () => void {
  const inBand = new Map<Element, BandEntry>();
  let order = 0;
  const observer = new IntersectionObserver(
    (entries) => {
      const entered: Element[] = [];
      for (const entry of entries) {
        if (entry.isIntersecting) {
          order += 1;
          inBand.set(entry.target, { ratio: entry.intersectionRatio, order });
          entered.push(entry.target);
        } else {
          inBand.delete(entry.target);
        }
      }
      const next =
        entered.length > 0
          ? pick(entered, (element) => inBand.get(element)?.ratio ?? -1)
          : pick(
              [...inBand.keys()],
              (element) => inBand.get(element)?.order ?? -1,
            );
      const focus = next === null ? undefined : targets.get(next);
      if (focus !== undefined) onChange(focus);
    },
    { rootMargin: FOCUS_ROOT_MARGIN, threshold: 0 },
  );
  for (const target of targets.keys()) observer.observe(target);
  return () => observer.disconnect();
}
