import { createRng } from './cosmos-theme';

export type CosmosNodeKind = 'p' | 's' | 'r';

export interface CosmosNode {
  kind: CosmosNodeKind;
  prog: number;
  name: string;
  tint: number;

  ph: number;
  sz: number;
  deg: number;

  degN: number;

  light: number;
  x: number;
  y: number;
  z: number;
}

export interface CosmosEdge {
  a: number;
  b: number;
  prog: number;
  ord: number;
  kind: 'sp' | 'rs' | 'ss';
}

export interface CosmosStar {
  x: number;
  y: number;
  r: number;
  ph: number;
  b: number;
}

export interface CosmosStarLayer {
  depth: number;
  alpha: number;
  stars: CosmosStar[];
}

export interface CosmosCurtain {
  x: number;
  w: number;
  top: number;
  h: number;
  amp: number;
  speed: number;
  ph: number;
  tint: number;
}

export interface CosmosStreak {
  a: number;
  r0: number;
  len: number;
  w: number;
}

export interface CosmosGraph {
  nodes: CosmosNode[];
  edges: CosmosEdge[];
  layers: CosmosStarLayer[];
  curtains: CosmosCurtain[];
  streaks: CosmosStreak[];
  hero: number;
  heroNeighbors: Set<number>;
  heroRepos: number[];
  programCount: number;
}

export const FOCUS_PROGRAM = 0;
export const HERO_HANDLE = '@example-user';

export const PROGRAM_TYPE_NAMES = [
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

function pick(words: readonly string[], value: number): string {
  return words[Math.floor(value * words.length)] ?? words[0] ?? '';
}

export function buildCosmosGraph(
  programNames: readonly string[] = PROGRAM_TYPE_NAMES,
): CosmosGraph {
  const rand = createRng(42);
  const names =
    programNames.length >= PROGRAM_TYPE_NAMES.length
      ? programNames.slice(0, PROGRAM_TYPE_NAMES.length)
      : [...programNames, ...PROGRAM_TYPE_NAMES.slice(programNames.length)];
  const programCount = names.length;
  const studentCount = 108;
  const repoCount = 152;

  const nodes: CosmosNode[] = [];
  const edges: CosmosEdge[] = [];

  const emptyNode = (
    kind: CosmosNodeKind,
    prog: number,
    name: string,
    tint: number,
    ph: number,
    sz: number,
  ): CosmosNode => ({
    kind,
    prog,
    name,
    tint,
    ph,
    sz,
    deg: 0,
    degN: 0,
    light: prog,
    x: 0,
    y: 0,
    z: 0,
  });

  for (let i = 0; i < programCount; i += 1) {
    nodes.push(emptyNode('p', i, names[i] ?? '', 0, rand() * 6.283, 1));
  }

  const studentStart = nodes.length;
  for (let i = 0; i < studentCount; i += 1) {
    const prog = Math.floor(rand() * programCount);
    nodes.push(
      emptyNode(
        's',
        prog,
        `@example-${100 + i}`,
        prog % 4,
        rand() * 6.283,
        0.85 + rand() * 0.4,
      ),
    );
    edges.push({ a: prog, b: nodes.length - 1, prog, ord: rand(), kind: 'sp' });
  }
  const studentEnd = nodes.length;

  for (let i = 0; i < repoCount; i += 1) {
    const pi = studentStart + Math.floor(rand() * studentCount);
    const parent = nodes[pi];
    if (!parent) continue;
    nodes.push(
      emptyNode(
        'r',
        parent.prog,
        `team-${pick(TEAM_WORDS, rand())}/${pick(REPO_WORDS, rand())}`,
        Math.floor(rand() * 4),
        rand() * 6.283,

        0.62 + rand() * rand() * 1.5,
      ),
    );
    edges.push({
      a: pi,
      b: nodes.length - 1,
      prog: parent.prog,
      ord: rand(),
      kind: 'rs',
    });
  }

  for (let i = 0; i < 26; i += 1) {
    const a = studentStart + Math.floor(rand() * studentCount);
    let b = a;
    while (b === a) b = studentStart + Math.floor(rand() * studentCount);
    edges.push({ a, b, prog: nodes[a]?.prog ?? 0, ord: rand(), kind: 'ss' });
  }

  const repoCountOf = new Map<number, number>();
  for (const edge of edges) {
    if (edge.kind === 'rs') {
      repoCountOf.set(edge.a, (repoCountOf.get(edge.a) ?? 0) + 1);
    }
  }
  let hero = studentStart;
  let best = -1;
  for (let i = studentStart; i < studentEnd; i += 1) {
    if (nodes[i]?.prog !== FOCUS_PROGRAM) continue;
    const count = repoCountOf.get(i) ?? 0;
    if (count > best) {
      best = count;
      hero = i;
    }
  }
  let have = repoCountOf.get(hero) ?? 0;
  for (const edge of edges) {
    if (have >= 6) break;
    if (edge.kind !== 'rs' || edge.a === hero) continue;
    if (nodes[edge.a]?.prog !== FOCUS_PROGRAM) continue;
    if ((repoCountOf.get(edge.a) ?? 0) <= 1) continue;
    repoCountOf.set(edge.a, (repoCountOf.get(edge.a) ?? 1) - 1);
    edge.a = hero;
    const target = nodes[edge.b];
    if (target) target.prog = FOCUS_PROGRAM;
    have += 1;
  }
  const heroNode = nodes[hero];
  if (heroNode) heroNode.name = HERO_HANDLE;

  const heroNeighbors = new Set<number>([hero, FOCUS_PROGRAM]);
  const heroRepos: number[] = [];
  for (const edge of edges) {
    if (edge.a === hero) {
      heroNeighbors.add(edge.b);
      if (nodes[edge.b]?.kind === 'r') heroRepos.push(edge.b);
    }
    if (edge.b === hero) {
      heroNeighbors.add(edge.a);
      if (nodes[edge.a]?.kind === 'r') heroRepos.push(edge.a);
    }
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
    node.deg = degrees[index] ?? 0;
    node.degN = Math.sqrt(node.deg / maxDegree[node.kind]);
  });

  const layers: CosmosStarLayer[] = [
    { depth: 0.18, count: 460, rMin: 0.35, rMax: 0.9, alpha: 0.5 },
    { depth: 0.42, count: 230, rMin: 0.6, rMax: 1.4, alpha: 0.68 },
    { depth: 0.75, count: 95, rMin: 1.0, rMax: 2.2, alpha: 0.9 },
  ].map((layer) => ({
    depth: layer.depth,
    alpha: layer.alpha,
    stars: Array.from({ length: layer.count }, () => ({
      x: rand(),
      y: rand(),
      r: layer.rMin + rand() * (layer.rMax - layer.rMin),
      ph: rand() * 6.283,
      b: 0.45 + rand() * 0.55,
    })),
  }));

  const curtains: CosmosCurtain[] = Array.from({ length: 4 }, (_, index) => ({
    x: 0.1 + rand() * 0.85,
    w: 0.22 + rand() * 0.3,
    top: -0.15 + rand() * 0.25,
    h: 0.55 + rand() * 0.5,
    amp: 0.03 + rand() * 0.055,
    speed: 0.00006 + rand() * 0.00011,
    ph: rand() * 6.283,
    tint: index % 3,
  }));

  const streaks: CosmosStreak[] = Array.from({ length: 80 }, () => ({
    a: rand() * 6.283,
    r0: 0.12 + rand() * 0.5,
    len: 0.12 + rand() * 0.5,
    w: 0.5 + rand() * 1.2,
  }));

  return {
    nodes,
    edges,
    layers,
    curtains,
    streaks,
    hero,
    heroNeighbors,
    heroRepos,
    programCount,
  };
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
  const scale = 0.7 / p92;
  for (let i = 0; i < n; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    node.x = px[i] * scale;
    node.y = py[i] * scale * 0.78;
    node.z = pz[i] * scale;
    node.light = node.prog;
  }
}
