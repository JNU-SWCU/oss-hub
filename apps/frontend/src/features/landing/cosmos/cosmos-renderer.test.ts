import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CosmosGraph, CosmosNode } from './cosmos-graph';
import { createCosmosRenderer, type CosmosFrame } from './cosmos-renderer';

const fillText = vi.fn<(text: string, x: number, y: number) => void>();

class FakeCanvas {
  width = 300;
  height = 150;
  readonly clientWidth = 1200;
  readonly clientHeight = 800;

  getContext() {
    return {
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      strokeText: vi.fn(),
      fillText,
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
  }
}

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

const graphWith = (nodes: CosmosNode[]): CosmosGraph => ({
  nodes,
  edges: [],
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
  ...overrides,
});

function setup(nodes: CosmosNode[], devicePixelRatio = 2) {
  vi.stubGlobal('window', { devicePixelRatio });
  const canvas = new FakeCanvas();
  const renderer = createCosmosRenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    graph: graphWith(nodes),
  });
  return { canvas, renderer };
}

afterEach(() => {
  vi.unstubAllGlobals();
  fillText.mockClear();
});

describe('createCosmosRenderer', () => {
  it('sizes the backing store by device pixel ratio times quality, capped at 2', () => {
    const { canvas, renderer } = setup([], 3);

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

    expect(renderer.pick(804, 400)).toBe(0);
    expect(renderer.pick(804 + 6, 400)).toBe(0);
    expect(renderer.pick(804 + 120, 400)).toBeNull();
  });

  it('picks a student when the cursor rests on it away from any program', () => {
    const { renderer } = setup([
      node('p', '프로그램', 0),
      { ...node('s', '@student', 0), x: 0.2 },
    ]);
    renderer.render(frame());

    const studentX = 804 + 0.2 * Math.min(1200 * 0.42, 800 * 0.56);
    expect(renderer.pick(studentX, 400)).toBe(1);
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

  it('stops picking after dispose', () => {
    const { renderer } = setup([node('p', '프로그램', 0)]);
    renderer.render(frame());
    expect(renderer.pick(804, 400)).toBe(0);

    renderer.dispose();

    expect(renderer.pick(804, 400)).toBeNull();
  });
});
