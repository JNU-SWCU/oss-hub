import { projectPoint, type CosmosProjected } from './cosmos-camera';
import {
  applyCosmosPrograms,
  type CosmosGraph,
  type CosmosNodeKind,
  type CosmosProgram,
} from './cosmos-graph';
import {
  COSMOS_NODE_ALPHA_STEPS,
  cosmosEdgeAlpha,
  cosmosEdgeBucket,
  cosmosEdgeBucketAlpha,
  cosmosEdgeReveal,
  cosmosLabelLit,
  cosmosLabelSize,
  cosmosNodeAlpha,
  cosmosNodeAlphaStep,
  cosmosNodeRadius,
  INITIAL_ORBIT,
} from './cosmos-initial';
import {
  COSMOS_LABEL_OFFSET,
  COSMOS_LABEL_PLATE_RADIUS,
  cosmosLabelPlate,
  cosmosLabelText,
  cosmosLabelWidth,
} from './cosmos-label';
import { settledCosmosGraph } from './cosmos-layout';
import { LABEL_PLATE_ALPHA } from './cosmos-theme';

export const COSMOS_POSTER_SCALE = 1000;

const NODE_RADIUS_STEP = 0.25;
const NODE_KINDS: readonly CosmosNodeKind[] = ['r', 's', 'p'];
const UNIT_VIEW = { cx: 0, cy: 0, radius: 1 } as const;
const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

interface NodeGroup {
  readonly kind: CosmosNodeKind;
  readonly step: number;
  readonly radius: number;
  readonly dots: string[];
}

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => ENTITIES[character] ?? character);

const num = (value: number, digits = 3): string =>
  value
    .toFixed(digits)
    .replace(/\.?0+$/, '')
    .replace(/^(-?)0\./, '$1.') || '0';

const unit = (value: number): number => Math.round(value * COSMOS_POSTER_SCALE);

const pair = (x: number, y: number): string => `${x}${y < 0 ? '' : ' '}${y}`;

function projectAll(graph: CosmosGraph): CosmosProjected[] {
  return graph.nodes.map((node) => {
    const point: CosmosProjected = {
      ok: false,
      x: 0,
      y: 0,
      scale: 0,
      depth: 0,
    };
    projectPoint(node.x, node.y, node.z, INITIAL_ORBIT, UNIT_VIEW, point);
    return point;
  });
}

function hubChains(
  points: readonly CosmosProjected[],
  spokes: ReadonlyMap<number, readonly number[]>,
): string {
  let d = '';
  for (const [hub, ends] of spokes) {
    const from = points[hub];
    if (!from) continue;
    const hx = unit(from.x);
    const hy = unit(from.y);
    d += `M${pair(hx, hy)}`;
    d += ends
      .map((end) => {
        const to = points[end];
        return to ? `l${pair(unit(to.x) - hx, unit(to.y) - hy)}` : '';
      })
      .join('z');
  }
  return d;
}

function edgePaths(
  graph: CosmosGraph,
  points: readonly CosmosProjected[],
): string {
  const reveal = cosmosEdgeReveal(0);
  const buckets = new Map<number, Map<number, number[]>>();
  for (const edge of graph.edges) {
    const a = points[edge.a];
    const b = points[edge.b];
    if (!a?.ok || !b?.ok) continue;
    const bucket = cosmosEdgeBucket(cosmosEdgeAlpha(a.depth, b.depth) * reveal);
    const spokes = buckets.get(bucket) ?? new Map<number, number[]>();
    buckets.set(bucket, spokes);
    const ends = spokes.get(edge.a);
    if (ends) ends.push(edge.b);
    else spokes.set(edge.a, [edge.b]);
  }
  return [...buckets]
    .sort(([a], [b]) => a - b)
    .map(
      ([bucket, spokes]) =>
        `<path stroke-opacity='${num(cosmosEdgeBucketAlpha(bucket), 5)}' d='${hubChains(points, spokes)}'/>`,
    )
    .join('');
}

function nodePaths(
  graph: CosmosGraph,
  points: readonly CosmosProjected[],
): string {
  const groups = new Map<string, NodeGroup>();
  graph.nodes.forEach((node, index) => {
    const point = points[index];
    if (!point?.ok) return;
    const step = cosmosNodeAlphaStep(cosmosNodeAlpha(node.kind, point.depth));
    const radius =
      Math.round((cosmosNodeRadius(node) * point.scale) / NODE_RADIUS_STEP) *
      NODE_RADIUS_STEP;
    const key = `${node.kind}${step}:${radius}`;
    const dot = `M${pair(unit(point.x), unit(point.y))}h0`;
    const group = groups.get(key);
    if (group) group.dots.push(dot);
    else groups.set(key, { kind: node.kind, step, radius, dots: [dot] });
  });
  return NODE_KINDS.map((kind) => {
    const sorted = [...groups.values()]
      .filter((group) => group.kind === kind)
      .sort((a, b) => a.step - b.step || a.radius - b.radius);
    let paths = '';
    for (let step = 1; step <= COSMOS_NODE_ALPHA_STEPS; step += 1) {
      const layer = sorted
        .filter((group) => group.step === step)
        .map(
          (group) =>
            `<path stroke-width='${num(group.radius * 2, 2)}' d='${group.dots.join('')}'/>`,
        )
        .join('');
      if (layer) {
        paths += `<g stroke-opacity='${num(step / COSMOS_NODE_ALPHA_STEPS)}'>${layer}</g>`;
      }
    }
    return paths ? `<g data-kind='${kind}'>${paths}</g>` : '';
  }).join('');
}

function labelPlates(
  graph: CosmosGraph,
  points: readonly CosmosProjected[],
): string {
  const programs: number[] = [];
  for (let index = 0; index < graph.programCount; index += 1) {
    if (points[index]?.ok && graph.nodes[index]?.name) programs.push(index);
  }
  programs.sort((a, b) => (points[b]?.depth ?? 0) - (points[a]?.depth ?? 0));
  const higherYs: number[] = [];
  let markup = '';
  for (const index of programs) {
    const node = graph.nodes[index];
    const point = points[index];
    if (!node || !point) continue;
    const gap = Math.min(...higherYs.map((y) => Math.abs(point.y - y)));
    higherYs.push(point.y);
    const text = cosmosLabelText(node.name);
    const size = Math.round(cosmosLabelSize(point.depth));
    const width = cosmosLabelWidth(text, size);
    const alpha = cosmosLabelLit(point.depth);
    const plate = cosmosLabelPlate(size, width);
    const offset = cosmosNodeRadius(node) * point.scale + COSMOS_LABEL_OFFSET;
    const vars = [
      `--x:${num(point.x, 4)}`,
      `--y:${num(point.y, 4)}`,
      `--offset:${num(offset, 1)}`,
      `--width:${width}`,
      `--size:${size}`,
    ];
    if (Number.isFinite(gap)) vars.push(`--gap:${num(gap, 4)}`);
    markup += `<g data-label style='${vars.join(';')}'><rect x='${plate.x}' y='${num(plate.y, 2)}' width='${plate.width}' height='${num(plate.height, 2)}' rx='${COSMOS_LABEL_PLATE_RADIUS}' fill-opacity='${num(alpha * LABEL_PLATE_ALPHA)}'/><text font-size='${size}' fill-opacity='${num(alpha)}'>${escape(text)}</text></g>`;
  }
  return markup;
}

export function cosmosPosterMarkup(programs: readonly CosmosProgram[]): string {
  const graph = settledCosmosGraph();
  applyCosmosPrograms(graph, programs);
  const points = projectAll(graph);
  const extent = COSMOS_POSTER_SCALE;
  return `<svg data-stage viewBox='${-extent} ${-extent} ${extent * 2} ${extent * 2}'>${edgePaths(graph, points)}${nodePaths(graph, points)}</svg><svg data-labels>${labelPlates(graph, points)}</svg>`;
}
