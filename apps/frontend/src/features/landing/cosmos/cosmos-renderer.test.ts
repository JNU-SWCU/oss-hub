import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CosmosGraph } from './cosmos-graph';
import { createCosmosRenderer } from './cosmos-renderer';

class FakeCanvas {
  width = 300;
  height = 150;
  readonly clientWidth = 1441;
  readonly clientHeight = 901;

  getContext() {
    return {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
    };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createCosmosRenderer', () => {
  it.each([1, 0.75])(
    'sizes new offscreen canvases when recreating at quality %s on the same canvas',
    (quality) => {
      const created: FakeCanvas[] = [];
      vi.stubGlobal('window', { devicePixelRatio: 2 });
      vi.stubGlobal('document', {
        createElement: () => {
          const canvas = new FakeCanvas();
          created.push(canvas);
          return canvas;
        },
      });
      const canvas = document.createElement('canvas');
      const graph: CosmosGraph = {
        nodes: [],
        edges: [],
        layers: [],
        curtains: [],
        streaks: [],
        hero: 0,
        heroNeighbors: new Set(),
        heroRepos: [],
        programCount: 0,
      };
      const sizes = () =>
        created.slice(1).map(({ width, height }) => [width, height]);
      const expectedBloom = [
        Math.round(Math.round(1441 * 2 * quality) / 3),
        Math.round(Math.round(901 * 2 * quality) / 3),
      ];
      const expectedAurora = [
        Math.ceil(Math.round(1441 * 2 * quality) / 4),
        Math.ceil(Math.round(901 * 2 * quality) / 4),
      ];
      const first = createCosmosRenderer({ canvas, graph });
      first.render(0, 0, quality);
      expect(sizes()).toEqual([expectedBloom, expectedAurora]);
      first.dispose();
      expect(sizes()).toEqual([
        [1, 1],
        [1, 1],
      ]);

      const second = createCosmosRenderer({ canvas, graph });
      second.render(0, 0, quality);

      expect([canvas.width, canvas.height]).toEqual([
        Math.round(1441 * 2 * quality),
        Math.round(901 * 2 * quality),
      ]);
      expect(sizes().slice(2)).toEqual([expectedBloom, expectedAurora]);
      second.dispose();
    },
  );
});
