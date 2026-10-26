import { createRng } from './cosmos-theme';

export type CosmosNodeKind = 'p' | 's' | 'r';

export interface CosmosNode {
  kind: CosmosNodeKind;
  prog: number;
  name: string;
  href: string | null;
  sz: number;
  degN: number;
  x: number;
  y: number;
  z: number;
}

interface CosmosEdge {
  a: number;
  b: number;
  kind: 'sp' | 'rs' | 'ss';
}

interface CosmosStar {
  x: number;
  y: number;
  r: number;
  a: number;
}

export interface CosmosGraph {
  nodes: CosmosNode[];
  edges: CosmosEdge[];
  stars: CosmosStar[];
  programCount: number;
}

export interface CosmosProgram {
  readonly name: string;
  readonly href: string | null;
}

const PROGRAM_TYPE_NAMES = [
  '오픈소스 해커톤',
  'OSS 기여 챌린지',
  '데이터·AI 스터디',
  'SW 경진대회',
  '세미나 · 워크숍',
  '멘토링 프로그램',
] as const;

const TEAM_WORDS = [
  'nova',
  'orion',
  'vega',
  'lyra',
  'atlas',
  'pulsar',
  'comet',
  'aurora',
];
const REPO_WORDS = [
  'api-server',
  'web-client',
  'infra',
  'docs',
  'mobile',
  'pipeline',
  'dashboard',
  'crawler',
];

const STUDENT_COUNT = 64;
const REPO_COUNT = 88;
const PEER_EDGE_COUNT = 18;
const STAR_COUNT = 260;

function pick(words: readonly string[], value: number): string {
  return words[Math.floor(value * words.length)] ?? words[0] ?? '';
}

export function buildCosmosGraph(): CosmosGraph {
  const rand = createRng(42);
  const programCount = PROGRAM_TYPE_NAMES.length;
  const nodes: CosmosNode[] = [];
  const edges: CosmosEdge[] = [];

  const emptyNode = (
    kind: CosmosNodeKind,
    prog: number,
    name: string,
    sz: number,
  ): CosmosNode => ({
    kind,
    prog,
    name,
    href: null,
    sz,
    degN: 0,
    x: 0,
    y: 0,
    z: 0,
  });

  for (let i = 0; i < programCount; i += 1) {
    nodes.push(emptyNode('p', i, PROGRAM_TYPE_NAMES[i] ?? '', 1));
  }

  const studentStart = nodes.length;
  for (let i = 0; i < STUDENT_COUNT; i += 1) {
    const prog = Math.floor(rand() * programCount);
    nodes.push(
      emptyNode('s', prog, `@example-${100 + i}`, 0.85 + rand() * 0.4),
    );
    edges.push({ a: prog, b: nodes.length - 1, kind: 'sp' });
  }

  for (let i = 0; i < REPO_COUNT; i += 1) {
    const pi = studentStart + Math.floor(rand() * STUDENT_COUNT);
    const parent = nodes[pi];
    if (!parent) continue;
    nodes.push(
      emptyNode(
        'r',
        parent.prog,
        `team-${pick(TEAM_WORDS, rand())}/${pick(REPO_WORDS, rand())}`,
        0.62 + rand() * rand() * 1.5,
      ),
    );
    edges.push({ a: pi, b: nodes.length - 1, kind: 'rs' });
  }

  for (let i = 0; i < PEER_EDGE_COUNT; i += 1) {
    const a = studentStart + Math.floor(rand() * STUDENT_COUNT);
    let b = a;
    while (b === a) b = studentStart + Math.floor(rand() * STUDENT_COUNT);
    edges.push({ a, b, kind: 'ss' });
  }

  const degrees = new Int32Array(nodes.length);
  for (const edge of edges) {
    degrees[edge.a] += 1;
    degrees[edge.b] += 1;
  }
  const maxDegree: Record<CosmosNodeKind, number> = { p: 1, s: 1, r: 1 };
  nodes.forEach((node, index) => {
    const degree = degrees[index] ?? 0;
    if (degree > maxDegree[node.kind]) maxDegree[node.kind] = degree;
  });
  nodes.forEach((node, index) => {
    node.degN = Math.sqrt((degrees[index] ?? 0) / maxDegree[node.kind]);
  });

  const stars: CosmosStar[] = Array.from({ length: STAR_COUNT }, () => ({
    x: rand(),
    y: rand(),
    r: 0.35 + rand() * rand() * 0.8,
    a: 0.12 + rand() * 0.36,
  }));

  return { nodes, edges, stars, programCount };
}

export function applyCosmosPrograms(
  graph: CosmosGraph,
  programs: readonly CosmosProgram[],
): void {
  let cursor = 0;
  for (const node of graph.nodes) {
    if (node.kind !== 'p') continue;
    const program = programs[cursor];
    cursor += 1;
    if (!program) continue;
    node.name = program.name;
    node.href = program.href;
  }
}

export function layoutCosmosGraph(graph: CosmosGraph, k = 0.28): void {
  const nodes = graph.nodes;
  const n = nodes.length;
  const rand = createRng(7);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);

  for (let i = 0; i < n; i += 1) {
    const u = rand() * 2 - 1;
    const theta = rand() * 6.283;
    const r = Math.cbrt(rand()) * 0.9;
    const q = Math.sqrt(1 - u * u);
    px[i] = q * Math.cos(theta) * r;
    py[i] = u * r;
    pz[i] = q * Math.sin(theta) * r;
  }

  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const dz = new Float64Array(n);

  const weights = { rs: 1.85, sp: 1.0, ss: 0.32 } as const;
  const k2 = k * k;
  const ITER = 240;

  for (let it = 0; it < ITER; it += 1) {
    dx.fill(0);
    dy.fill(0);
    dz.fill(0);

    for (let i = 0; i < n; i += 1) {
      const xi = px[i];
      const yi = py[i];
      const zi = pz[i];
      for (let j = i + 1; j < n; j += 1) {
        let ax = xi - px[j];
        const ay = yi - py[j];
        const az = zi - pz[j];
        let d2 = ax * ax + ay * ay + az * az;
        if (d2 < 1e-6) {
          ax = 1e-3;
          d2 = 1e-6;
        }
        const f = k2 / d2;
        dx[i] += ax * f;
        dy[i] += ay * f;
        dz[i] += az * f;
        dx[j] -= ax * f;
        dy[j] -= ay * f;
        dz[j] -= az * f;
      }
    }

    for (const edge of graph.edges) {
      const a = edge.a;
      const b = edge.b;
      const ax = px[a] - px[b];
      const ay = py[a] - py[b];
      const az = pz[a] - pz[b];
      const d = Math.sqrt(ax * ax + ay * ay + az * az) + 1e-6;
      const f = (d / k) * weights[edge.kind];
      const ux = (ax / d) * f;
      const uy = (ay / d) * f;
      const uz = (az / d) * f;
      dx[a] -= ux;
      dy[a] -= uy;
      dz[a] -= uz;
      dx[b] += ux;
      dy[b] += uy;
      dz[b] += uz;
    }

    for (let i = 0; i < n; i += 1) {
      const g = 0.09 * (0.4 + (nodes[i]?.degN ?? 0));
      dx[i] -= px[i] * g;
      dy[i] -= py[i] * g;
      dz[i] -= pz[i] * g;
    }

    const t = 0.22 * (1 - it / ITER) + 0.004;
    for (let i = 0; i < n; i += 1) {
      const ddx = dx[i];
      const ddy = dy[i];
      const ddz = dz[i];
      const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) + 1e-9;
      const s = Math.min(d, t) / d;
      px[i] += ddx * s;
      py[i] += ddy * s;
      pz[i] += ddz * s;
    }
  }

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i += 1) {
    cx += px[i];
    cy += py[i];
    cz += pz[i];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  const radii = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    px[i] -= cx;
    py[i] -= cy;
    pz[i] -= cz;
    radii[i] = Math.hypot(px[i], py[i], pz[i]);
  }
  const sorted = Array.from(radii).sort((a, b) => a - b);
  const p92 = sorted[Math.floor(n * 0.92)] || 1;
  const scale = 0.82 / p92;
  for (let i = 0; i < n; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    node.x = px[i] * scale;
    node.y = py[i] * scale * 0.88;
    node.z = pz[i] * scale;
  }
}
