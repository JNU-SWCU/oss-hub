import { describe, expect, it } from 'vitest';
import { applyCosmosPrograms } from './cosmos-graph';
import { INITIAL_ORBIT } from './cosmos-initial';
import { COSMOS_LABEL_GAP, cosmosLabelPlate } from './cosmos-label';
import { settledCosmosGraph } from './cosmos-layout';
import {
  COSMOS_POSTER_SCALE,
  cosmosPosterMarkup,
} from './cosmos-poster-markup';
import { parseRgba } from './cosmos-contrast-test-support';
import {
  CENTER_X,
  CENTER_Y,
  RADIUS,
  fills,
  fillText,
  frame,
  labelPairs,
  setupGraph,
  strokes,
} from './cosmos-renderer-test-support';

const WIDTH = 1200;
const HEIGHT = 800;
const PROGRAMS = [
  'seed-program-basic',
  'seed-program-capstone',
  'seed-program-corporate_internship',
  'seed-program-empty-applications',
  'seed-program-global_makerthon',
  'seed-program-no-repository',
].map((name) => ({ name, href: `/programs/${name}` }));

const toPx = (value: string, center: number): number =>
  center + (RADIUS * Number(value)) / COSMOS_POSTER_SCALE;

const alphaOf = (css: string): number => parseRgba(css).alpha;

interface Dot {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
}

function posterDots(markup: string): Dot[] {
  const dots: Dot[] = [];
  for (const layer of markup.matchAll(
    /<g stroke-opacity='([^']+)'>(.*?)<\/g>/g,
  )) {
    for (const path of layer[2].matchAll(
      /<path stroke-width='([^']+)' d='([^']+)'\/>/g,
    )) {
      for (const dot of path[2].matchAll(/M(-?\d+) ?(-?\d+)h0/g)) {
        dots.push({
          x: toPx(dot[1], CENTER_X),
          y: toPx(dot[2], CENTER_Y),
          radius: Number(path[1]) / 2,
          alpha: Number(layer[1]),
        });
      }
    }
  }
  return dots;
}

interface Segment {
  readonly alpha: number;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
}

function posterSegments(markup: string): Segment[] {
  const segments: Segment[] = [];
  const stage = markup.slice(0, markup.indexOf('<g data-kind'));
  for (const path of stage.matchAll(
    /<path stroke-opacity='([^']+)' d='([^']+)'\/>/g,
  )) {
    const alpha = Number(path[1]);
    for (const chain of path[2].matchAll(
      /M(-?\d+) ?(-?\d+)((?:l-?\d+ ?-?\d+z?)+)/g,
    )) {
      const from = [
        toPx(chain[1], CENTER_X),
        toPx(chain[2], CENTER_Y),
      ] as const;
      for (const spoke of chain[3].matchAll(/l(-?\d+) ?(-?\d+)/g)) {
        segments.push({
          alpha,
          from,
          to: [
            from[0] + (RADIUS * Number(spoke[1])) / COSMOS_POSTER_SCALE,
            from[1] + (RADIUS * Number(spoke[2])) / COSMOS_POSTER_SCALE,
          ],
        });
      }
    }
  }
  return segments;
}

interface Label {
  readonly text: string;
  readonly left: number;
  readonly middle: number;
  readonly alpha: number;
  readonly hidden: boolean;
}

function posterLabels(markup: string): Label[] {
  const labels: Label[] = [];
  for (const group of markup.matchAll(
    /<g data-label style='([^']+)'><rect[^>]*\/><text font-size='(\d+)' fill-opacity='([^']+)'>([^<]*)<\/text><\/g>/g,
  )) {
    const vars = Object.fromEntries(
      group[1].split(';').map((entry) => {
        const [key, value] = entry.split(':');
        return [key, Number(value)];
      }),
    ) as Record<string, number>;
    const x = vars['--x'] ?? 0;
    const y = vars['--y'] ?? 0;
    const offset = vars['--offset'] ?? 0;
    const width = vars['--width'] ?? 0;
    const size = vars['--size'] ?? 0;
    const gap = vars['--gap'] ?? 1;
    const flip = RADIUS * x + offset + width + 12 > WIDTH / 2;
    const left =
      WIDTH / 2 + RADIUS * x + offset - (flip ? width + 2 * offset : 0);
    const middle = HEIGHT * 0.48 + RADIUS * y;
    labels.push({
      text: group[4],
      left,
      middle,
      alpha: Number(group[3]),
      hidden:
        RADIUS * gap < COSMOS_LABEL_GAP ||
        left < 8 ||
        middle - size * 0.62 < 8 ||
        middle + size * 0.5 > HEIGHT - 8,
    });
  }
  return labels;
}

function firstEntranceFrame() {
  const graph = settledCosmosGraph();
  applyCosmosPrograms(graph, PROGRAMS);
  graph.stars = [];
  const { renderer } = setupGraph(graph, { entranceMs: 1400 });
  renderer.render(frame({ ...INITIAL_ORBIT }));
}

const near = (a: number, b: number, tolerance: number): boolean =>
  Math.abs(a - b) <= tolerance;

describe('cosmosPosterMarkup', () => {
  it('places every star where the canvas draws it on the first entrance frame, with the same radius and alpha', () => {
    const dots = posterDots(cosmosPosterMarkup(PROGRAMS));
    firstEntranceFrame();
    const drawn = fills
      .filter((fill) => fill.arcs.length > 0)
      .flatMap((fill) =>
        fill.arcs.map(([x, y, radius]) => ({
          x,
          y,
          radius,
          alpha: alphaOf(fill.style),
        })),
      );

    expect(dots).toHaveLength(158);
    expect(drawn).toHaveLength(dots.length);
    for (const dot of dots) {
      const match = drawn.find(
        (star) =>
          near(star.x, dot.x, 0.5) &&
          near(star.y, dot.y, 0.5) &&
          near(star.radius, dot.radius, 0.125) &&
          near(star.alpha, dot.alpha, 0.001),
      );
      expect(match, JSON.stringify(dot)).toBeDefined();
    }
  });

  it('draws every edge between the same endpoints and at the same bucketed alpha as the first entrance frame', () => {
    const segments = posterSegments(cosmosPosterMarkup(PROGRAMS));
    firstEntranceFrame();
    const drawn = strokes.flatMap((stroke) =>
      stroke.lines.map(([from, to]) => ({
        alpha: alphaOf(stroke.style),
        from,
        to,
      })),
    );

    expect(segments).toHaveLength(170);
    expect(drawn).toHaveLength(segments.length);
    for (const segment of segments) {
      const match = drawn.find(
        (line) =>
          near(line.alpha, segment.alpha, 0.00001) &&
          near(line.from[0], segment.from[0], 0.5) &&
          near(line.from[1], segment.from[1], 0.5) &&
          near(line.to[0], segment.to[0], 0.5) &&
          near(line.to[1], segment.to[1], 0.5),
      );
      expect(match, JSON.stringify(segment)).toBeDefined();
    }
  });

  it('shows exactly the labels the canvas places, anchored at the same point with the same ink alpha', () => {
    const labels = posterLabels(cosmosPosterMarkup(PROGRAMS));
    firstEntranceFrame();
    const drawn = fillText.mock.calls.map(([text, x, y], index) => ({
      text,
      x,
      y,
      alpha: alphaOf(labelPairs[index]?.text ?? ''),
    }));

    expect(labels).toHaveLength(6);
    expect(labels.filter((label) => label.hidden)).toHaveLength(1);
    const visible = labels.filter((label) => !label.hidden);
    expect(drawn.map((label) => label.text).sort()).toEqual(
      visible.map((label) => label.text).sort(),
    );
    for (const label of visible) {
      const match = drawn.find((entry) => entry.text === label.text);
      expect(match).toBeDefined();
      expect(match?.x).toBeCloseTo(label.left, 0);
      expect(match?.y).toBeCloseTo(label.middle, 0);
      expect(match?.alpha).toBeCloseTo(label.alpha, 2);
    }
  });

  it('keeps surviving labels vertically apart at the smallest supported sky, so the canvas overlap rule never fires', () => {
    const graph = settledCosmosGraph();
    const smallest = Math.min(320 * 0.46, 320 * 0.42);
    const tallest = cosmosLabelPlate(13, 0).height;
    const markup = cosmosPosterMarkup(PROGRAMS);
    const ys = [...markup.matchAll(/--y:(-?[.\d]+)/g)].map((match) =>
      Number(match[1]),
    );

    expect(ys).toHaveLength(graph.programCount);
    for (const [index, a] of ys.entries()) {
      for (const b of ys.slice(index + 1)) {
        const distance = Math.abs(a - b) * smallest;
        expect(distance < COSMOS_LABEL_GAP || distance > tallest).toBe(true);
      }
    }
  });

  it('stays under eight kilobytes with six full-length program names', () => {
    const programs = PROGRAMS.map((program, index) => ({
      ...program,
      name: `${'W'.repeat(28)}${index}`,
    }));

    const markup = cosmosPosterMarkup(programs);

    expect(Buffer.byteLength(markup)).toBeLessThan(8000);
    expect(markup.match(/<text/g)).toHaveLength(6);
  });

  it('escapes program names and labels only named programs', () => {
    const markup = cosmosPosterMarkup([
      { name: `<b>&"'`, href: null },
      { name: '', href: null },
    ]);

    expect(markup).toContain('>&lt;b&gt;&amp;&quot;&#39;</text>');
    expect(markup).not.toContain('<b>');
    expect(markup.match(/<text/g)).toHaveLength(1);
  });
});
