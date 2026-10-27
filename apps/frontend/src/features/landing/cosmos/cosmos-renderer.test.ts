import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CosmosGraph, CosmosNode } from './cosmos-graph';
import {
  createCosmosRenderer,
  type CosmosFocus,
  type CosmosFrame,
} from './cosmos-renderer';

const fillText = vi.fn<(text: string, x: number, y: number) => void>();
const arc = vi.fn<(x: number, y: number, r: number) => void>();
const createRadialGradient = vi.fn(() => ({ addColorStop: vi.fn() }));

class FakeCanvas {
  width = 300;
  height = 150;
  readonly clientWidth = 1200;
  readonly clientHeight = 800;

  getContext() {
    return {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc,
      fill: vi.fn(),
      stroke: vi.fn(),
      strokeText: vi.fn(),
      fillText,
      createRadialGradient,
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
  }
}

const CENTER_X = 1200 * 0.5;
const CENTER_Y = 800 * 0.48;
const RADIUS = Math.min(1200 * 0.46, 800 * 0.42);

const node = (
  kind: CosmosNode['kind'],
  name: string,
  z: number,
  href: string | null = null,
): CosmosNode => ({
  kind,
  prog: 0,
  name,
  href,
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

const frame = (overrides: Partial<CosmosFrame> = {}): CosmosFrame => ({
  time: 0,
  yaw: 0,
  pitch: 0,
  zoom: 1,
  hovered: null,
  qualityScale: 1,
  focus: 'hero',
  ...overrides,
});

function setup(
  nodes: CosmosNode[],
  options: {
    devicePixelRatio?: number;
    entranceMs?: number;
    edges?: CosmosGraph['edges'];
  } = {},
) {
  vi.stubGlobal('window', { devicePixelRatio: options.devicePixelRatio ?? 2 });
  const canvas = new FakeCanvas();
  const renderer = createCosmosRenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    graph: graphWith(nodes, options.edges),
    entranceMs: options.entranceMs ?? 0,
  });
  return { canvas, renderer };
}

const arcsAt = (x: number, y: number) =>
  arc.mock.calls.filter(
    ([ax, ay]) => Math.abs(ax - x) < 0.01 && Math.abs(ay - y) < 0.01,
  );

const arcAt = (x: number, y: number) => arcsAt(x, y)[0];

const programRadius = (): number => {
  const call = arcsAt(CENTER_X, CENTER_Y).at(-1);
  if (!call) throw new Error('program node was not drawn at the center');
  return call[2];
};

function settle(
  renderer: ReturnType<typeof createCosmosRenderer>,
  focus: CosmosFocus,
  from: number,
  ms: number,
): number {
  let time = from;
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
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
});

describe('createCosmosRenderer', () => {
  it('sizes the backing store by device pixel ratio times quality, capped at 2', () => {
    const { canvas, renderer } = setup([], { devicePixelRatio: 3 });

    renderer.render(frame({ qualityScale: 0.5 }));
    expect([canvas.width, canvas.height]).toEqual([1800, 1200]);

    renderer.render(frame({ qualityScale: 1 }));
    expect([canvas.width, canvas.height]).toEqual([2400, 1600]);
  });

  it('picks the program drawn on top when a student shares its screen position', () => {
    const { renderer } = setup([
      node('p', '프로그램', 0),
      node('s', '@student', 0.3),
    ]);
    renderer.render(frame());

    expect(renderer.pick(CENTER_X, CENTER_Y)).toBe(0);
    expect(renderer.pick(CENTER_X + 6, CENTER_Y)).toBe(0);
    expect(renderer.pick(CENTER_X + 120, CENTER_Y)).toBeNull();
  });

  it('picks a student when the cursor rests on it away from any program', () => {
    const { renderer } = setup([
      node('p', '프로그램', 0),
      { ...node('s', '@student', 0), x: 0.2 },
    ]);
    renderer.render(frame());

    expect(renderer.pick(CENTER_X + 0.2 * RADIUS, CENTER_Y)).toBe(1);
  });

  it('truncates long program labels to 28 characters and shows the full name on hover', () => {
    const name = '공개 OSS 기여 프로그램 2026 상반기 캠퍼스 오픈소스 챌린지';
    const { renderer } = setup([node('p', name, 0)]);

    renderer.render(frame());
    expect(fillText.mock.calls.map(([text]) => text)).toEqual([
      `${name.slice(0, 27)}…`,
    ]);

    fillText.mockClear();
    renderer.render(frame({ time: 1000, hovered: 0 }));
    expect(fillText.mock.calls.map(([text]) => text)).toEqual([name]);
  });

  it('grows program nodes over the 600ms focus transition and settles at 1.35x', () => {
    const { renderer } = setup([
      node('p', '프로그램', 0),
      { ...node('s', '@student', 0), x: 0.3 },
    ]);
    renderer.render(frame({ time: 0 }));
    const base = programRadius();

    arc.mockClear();
    renderer.render(frame({ time: 300, focus: 'programs' }));
    const midway = programRadius();
    expect(midway).toBeGreaterThan(base);
    expect(midway).toBeLessThan(base * 1.35);

    arc.mockClear();
    settle(renderer, 'programs', 300, 600);
    expect(programRadius()).toBeCloseTo(base * 1.35, 6);

    arc.mockClear();
    settle(renderer, 'hero', 900, 600);
    expect(programRadius()).toBeCloseTo(base, 6);
  });

  it('draws the flow pulse only while the flow chapter is focused', () => {
    const edges: CosmosGraph['edges'] = [
      { a: 0, b: 1, kind: 'sp' },
      { a: 1, b: 2, kind: 'rs' },
    ];
    const { renderer } = setup(
      [
        node('p', '프로그램', 0),
        { ...node('s', '@student', 0), x: 0.4 },
        { ...node('r', 'team-nova/api', 0), x: 0.4, y: 0.4 },
      ],
      { edges },
    );
    settle(renderer, 'hero', 0, 600);
    expect(createRadialGradient).not.toHaveBeenCalled();

    settle(renderer, 'flow', 600, 600);
    createRadialGradient.mockClear();
    renderer.render(frame({ time: 1250, focus: 'flow' }));
    expect(createRadialGradient).toHaveBeenCalledTimes(1);
  });

  it('assembles nodes from scattered positions and settles exactly on the layout after the entrance', () => {
    const { renderer } = setup([node('p', '프로그램', 0)], {
      entranceMs: 1000,
    });

    renderer.render(frame({ time: 0 }));
    const [startX, startY] = arc.mock.calls[0] ?? [];
    expect(Math.hypot(startX - CENTER_X, startY - CENTER_Y)).toBeGreaterThan(
      50,
    );

    arc.mockClear();
    renderer.render(frame({ time: 500 }));
    const [midX, midY] = arc.mock.calls[0] ?? [];
    expect(Math.hypot(midX - CENTER_X, midY - CENTER_Y)).toBeLessThan(
      Math.hypot(startX - CENTER_X, startY - CENTER_Y),
    );

    arc.mockClear();
    renderer.render(frame({ time: 1000 }));
    expect(arcAt(CENTER_X, CENTER_Y)).toBeDefined();

    arc.mockClear();
    renderer.render(frame({ time: 1600 }));
    expect(arcAt(CENTER_X, CENTER_Y)).toBeDefined();
  });

  it('stops picking after dispose', () => {
    const { renderer } = setup([node('p', '프로그램', 0)]);
    renderer.render(frame());
    expect(renderer.pick(CENTER_X, CENTER_Y)).toBe(0);

    renderer.dispose();

    expect(renderer.pick(CENTER_X, CENTER_Y)).toBeNull();
  });
});
