'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  applyCosmosPrograms,
  attachCosmosInteraction,
  createCosmosQualityGovernor,
  createCosmosRenderer,
  type CosmosFocus,
  type CosmosProgram,
} from '../cosmos';
import { settledCosmosGraph } from '../cosmos/cosmos-layout';
import { isCosmosFocus, observeChapterFocus } from './landing-focus';

let entrancePlayed = false;

export function useCosmosCanvas(programs: readonly CosmosProgram[]) {
  const router = useRouter();
  const journeyRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const focusRef = useRef<CosmosFocus>('hero');
  const [focus, setFocus] = useState<CosmosFocus>('hero');

  useEffect(() => {
    const canvas = canvasRef.current;
    const sky = skyRef.current;
    const journey = journeyRef.current;
    if (!canvas || !sky || !journey) return;

    const graph = settledCosmosGraph();
    applyCosmosPrograms(graph, programs);
    let renderer: ReturnType<typeof createCosmosRenderer> | null = null;
    const quality = createCosmosQualityGovernor();
    const interaction = attachCosmosInteraction({
      canvas,
      pick: (x, y) => renderer?.pick(x, y) ?? null,
      canOpen: (index) => typeof graph.nodes[index]?.href === 'string',
      open: (index) => {
        const href = graph.nodes[index]?.href;
        if (href) router.push(href);
      },
    });
    let frame: number | null = null;
    let visible = false;
    let painted = false;
    const loop = (time: number): void => {
      frame = window.requestAnimationFrame(loop);
      const startedAt = performance.now();
      renderer ??= createCosmosRenderer({
        canvas,
        graph,
        fontFamily:
          window.getComputedStyle(journey).fontFamily ||
          'system-ui, sans-serif',
        entranceMs: entrancePlayed || startedAt > 1200 ? 0 : 1400,
      });
      entrancePlayed = true;
      interaction.advance();
      renderer.render({
        ...interaction.orbit(),
        time,
        hovered: interaction.hovered(),
        qualityScale: quality.qualityScale(),
        focus: focusRef.current,
      });
      if (
        !painted &&
        canvas.clientWidth &&
        canvas.clientHeight &&
        canvas.getContext('2d')
      ) {
        painted = true;
        sky.dataset.canvasReady = 'true';
      }
      quality.recordFrame(
        performance.now() - startedAt,
        window.innerWidth < 1024 ? 33 : 16.7,
      );
    };
    const stop = (): void => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    };
    const syncActivity = (): void => {
      if (visible && document.visibilityState === 'visible') {
        if (frame === null) frame = window.requestAnimationFrame(loop);
      } else stop();
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) visible = entry.isIntersecting;
      syncActivity();
    });
    observer.observe(sky);
    document.addEventListener('visibilitychange', syncActivity);
    const targets = new Map<Element, CosmosFocus>();
    for (const element of journey.querySelectorAll<HTMLElement>(
      'section[data-focus]',
    )) {
      const mode = element.dataset.focus;
      if (isCosmosFocus(mode)) targets.set(element, mode);
    }
    const stopFocus = observeChapterFocus(targets, (next) => {
      focusRef.current = next;
      setFocus(next);
    });
    return () => {
      stop();
      stopFocus();
      observer.disconnect();
      document.removeEventListener('visibilitychange', syncActivity);
      interaction.dispose();
      renderer?.dispose();
      delete sky.dataset.canvasReady;
    };
  }, [router, programs]);

  return { journeyRef, skyRef, canvasRef, focus };
}
