import { afterEach, vi } from 'vitest';
import type { CosmosGraph, CosmosNode } from './cosmos-graph';
import {
  createCosmosRenderer,
  type CosmosFocus,
  type CosmosFrame,
} from './cosmos-renderer';
export const fillText = vi.fn<(text: string, x: number, y: number) => void>();
export const arc = vi.fn<(x: number, y: number, r: number) => void>();
export const createRadialGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
export const labelPairs: { plate: string; text: string }[] = [];

class FakeCanvas {
  width = 300;
  height = 150;
  readonly clientWidth = 1200;
  readonly clientHeight = 800;

  getContext() {
    let plateArmed = false;
    let plate = '';
    const ctx = {
      fillStyle: '',
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      roundRect: () => {
        plateArmed = true;
      },
      arc,
      fill: () => {
        if (!plateArmed) return;
        plate = ctx.fillStyle;
        plateArmed = false;
      },
      stroke: vi.fn(),
      strokeText: vi.fn(),
      fillText: (text: string, x: number, y: number) => {
        labelPairs.push({ plate, text: ctx.fillStyle });
        fillText(text, x, y);
      },
      createRadialGradient,
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
    return ctx;
  }
}

export const CENTER_X = 1200 * 0.5;
export const CENTER_Y = 800 * 0.48;
export const RADIUS = Math.min(1200 * 0.46, 800 * 0.42);

export const node = (
  kind: CosmosNode['kind'],
  name: string,
  z: number,
): CosmosNode => ({
  kind,
  prog: 0,
  name,
  href: null,
  sz: 1,
  degN: 1,
  x: 0,
  y: 0,
  z,
});

const graphWith = (
  nodes: CosmosNode[],
  edges: CosmosGraph['edges'] = [],
): CosmosGraph => ({
  nodes,
  edges,
  stars: [],
  programCount: nodes.filter((entry) => entry.kind === 'p').length,
});

export const frame = (overrides: Partial<CosmosFrame> = {}): CosmosFrame => ({
  time: 0,
  yaw: 0,
  pitch: 0,
  zoom: 1,
  hovered: null,
  qualityScale: 1,
  focus: 'hero',
  ...overrides,
});

export function setupGraph(
  graph: CosmosGraph,
  options: { devicePixelRatio?: number; entranceMs?: number } = {},
) {
  vi.stubGlobal('window', { devicePixelRatio: options.devicePixelRatio ?? 2 });
  const canvas = new FakeCanvas();
  const renderer = createCosmosRenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    graph,
    entranceMs: options.entranceMs ?? 0,
  });
  return { canvas, renderer };
}

export function setup(
  nodes: CosmosNode[],
  options: {
    devicePixelRatio?: number;
    entranceMs?: number;
    edges?: CosmosGraph['edges'];
  } = {},
) {
  return setupGraph(graphWith(nodes, options.edges), options);
}

export const drawnLabels = (): string[] =>
  fillText.mock.calls.map(([text]) => text);

const arcsAt = (x: number, y: number) =>
  arc.mock.calls.filter(
    ([ax, ay]) => Math.abs(ax - x) < 0.01 && Math.abs(ay - y) < 0.01,
  );

export const arcAt = (x: number, y: number) => arcsAt(x, y)[0];

export const programRadius = (): number => {
  const call = arcsAt(CENTER_X, CENTER_Y).at(-1);
  if (!call) throw new Error('program node was not drawn at the center');
  return call[2];
};

export function settle(
  renderer: ReturnType<typeof createCosmosRenderer>,
  focus: CosmosFocus,
  interval: { readonly from: number; readonly ms: number },
): number {
  let time = interval.from;
  for (let elapsed = 0; elapsed < interval.ms; elapsed += 50) {
    time += 50;
    renderer.render(frame({ time, focus }));
  }
  return time;
}

afterEach(() => {
  vi.unstubAllGlobals();
  fillText.mockClear();
  arc.mockClear();
  createRadialGradient.mockClear();
  labelPairs.length = 0;
});
