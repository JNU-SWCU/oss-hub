import { createRng } from './cosmos-theme';

/**
 * 히어로 캔버스가 그리는 그래프. 화면 연출용 예시 구성이며 실제 사용자·팀
 * 데이터를 담지 않는다 — 범례에 `예시 구성`으로 표기한다. 프로그램 항성의
 * 이름만 공개 프로그램 유형에서 가져온다.
 */
export type CosmosNodeKind = 'p' | 's' | 'r';

export interface CosmosNode {
  kind: CosmosNodeKind;
  prog: number;
  name: string;
  tint: number;
  /** 노드마다 고정된 위상 — 시간에 따라 밝기가 오르내리지 않게 한다 */
  ph: number;
  sz: number;
  deg: number;
  /** 0~1로 정규화한 차수 — 노드 크기의 근거 */
  degN: number;
  /** 행성의 광원 = 자기 프로그램 항성 */
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

/** 사업단이 운영하는 프로그램 유형 — 공개 프로그램명이 있으면 앞에서부터 대체된다 */
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
        // 행성 크기 편차 — 전부 같은 크기면 "점"으로 보이고 "행성"으로 안 보인다
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

  // 주인공 — 포커스 프로그램에서 저장소가 가장 많은 학생
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

  // 차수(degree) — 연결이 많을수록 큰 천체
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

  // 배경 별 3층 — 층마다 시차가 다르다. b는 별마다 고정된 밝기로,
  // 시간에 따라 변하면 화면 전체가 미세하게 깜빡이는 것처럼 보인다.
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

  // 오로라 커튼 — 배경에 걸리는 흐린 빛의 장막
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

  // 속도선 — 하이퍼드라이브용 고정 각도 세트
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

/**
 * 힘 기반 레이아웃 (Fruchterman-Reingold 3D). 스프링(링크)과 반발(노드)로
 * 스스로 자리를 잡는다. 초기화 때 정해진 횟수만 돌리고 그대로 굳힌다 —
 * 상시 시뮬레이션이 아니라 떨림이 없고 매 로드 같은 배치가 나온다.
 */
export function layoutCosmosGraph(graph: CosmosGraph, k = 0.28): void {
  const nodes = graph.nodes;
  const n = nodes.length;
  const rand = createRng(7);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);

  for (let i = 0; i < n; i += 1) {
    // 구 안에 균일하게 뿌린 초기값
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
  // 링크 종류별 당기는 세기. rs(저장소↔학생)를 너무 크게 잡으면 저장소가
  // 학생 위에 겹쳐 붙어 마지막 장면에서 라벨이 하나만 남는다.
  const weights = { rs: 1.85, sp: 1.0, ss: 0.32 } as const;
  const k2 = k * k;
  const ITER = 240;

  for (let it = 0; it < ITER; it += 1) {
    dx.fill(0);
    dy.fill(0);
    dz.fill(0);

    // 반발 — 모든 쌍
    for (let i = 0; i < n; i += 1) {
      const xi = px[i] as number;
      const yi = py[i] as number;
      const zi = pz[i] as number;
      for (let j = i + 1; j < n; j += 1) {
        let ax = xi - (px[j] as number);
        const ay = yi - (py[j] as number);
        const az = zi - (pz[j] as number);
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

    // 인력 — 링크
    for (const edge of graph.edges) {
      const a = edge.a;
      const b = edge.b;
      const ax = (px[a] as number) - (px[b] as number);
      const ay = (py[a] as number) - (py[b] as number);
      const az = (pz[a] as number) - (pz[b] as number);
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

    // 중력 — 차수가 클수록 강하게. 허브가 안쪽으로 모인다.
    for (let i = 0; i < n; i += 1) {
      const g = 0.09 * (0.4 + (nodes[i]?.degN ?? 0));
      dx[i] -= (px[i] as number) * g;
      dy[i] -= (py[i] as number) * g;
      dz[i] -= (pz[i] as number) * g;
    }

    // 냉각 — 갈수록 조금씩만 움직여 마지막에 굳는다
    const t = 0.22 * (1 - it / ITER) + 0.004;
    for (let i = 0; i < n; i += 1) {
      const ddx = dx[i] as number;
      const ddy = dy[i] as number;
      const ddz = dz[i] as number;
      const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) + 1e-9;
      const s = Math.min(d, t) / d;
      px[i] += ddx * s;
      py[i] += ddy * s;
      pz[i] += ddz * s;
    }
  }

  // 중심 정렬 → 크기 정규화 → 은하처럼 살짝 납작하게
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i += 1) {
    cx += px[i] as number;
    cy += py[i] as number;
    cz += pz[i] as number;
  }
  cx /= n;
  cy /= n;
  cz /= n;
  const radii = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    px[i] -= cx;
    py[i] -= cy;
    pz[i] -= cz;
    radii[i] = Math.hypot(px[i] as number, py[i] as number, pz[i] as number);
  }
  const sorted = Array.from(radii).sort((a, b) => a - b);
  const p92 = sorted[Math.floor(n * 0.92)] || 1;
  const scale = 0.7 / p92;
  for (let i = 0; i < n; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    node.x = (px[i] as number) * scale;
    node.y = (py[i] as number) * scale * 0.78; // y를 눌러 원반형 은하로
    node.z = (pz[i] as number) * scale;
    node.light = node.prog;
  }
}
