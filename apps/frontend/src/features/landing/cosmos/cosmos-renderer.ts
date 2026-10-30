import {
  projectPoint,
  viewFor,
  type CosmosOrbit,
  type CosmosProjected,
} from './cosmos-camera';
import type { CosmosGraph, CosmosNode, CosmosNodeKind } from './cosmos-graph';
import {
  clamp,
  createRng,
  DAWN_THEME,
  LABEL_MIN_ALPHA,
  LABEL_PLATE_ALPHA,
  labelInk,
  lerp,
  mixColor,
  NIGHT_THEME,
  rgba,
  smoothstep,
  type CosmosColor,
  type CosmosLabelInk,
  type CosmosTheme,
} from './cosmos-theme';

export type CosmosFocus = 'hero' | 'programs' | 'flow' | 'activity';

export interface CosmosFrame extends CosmosOrbit {
  readonly time: number;
  readonly hovered: number | null;
  readonly qualityScale: number;
  readonly focus: CosmosFocus;
}

export interface CosmosRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly graph: CosmosGraph;
  readonly theme?: CosmosTheme;
  readonly dayTheme?: CosmosTheme;
  readonly fontFamily?: string;
  readonly entranceMs?: number;
}

export interface CosmosRenderer {
  render: (frame: CosmosFrame) => void;
  pick: (x: number, y: number) => number | null;
  dispose: () => void;
}

interface FlowPath {
  readonly program: number;
  readonly student: number;
  readonly repository: number;
}

const LABEL_MAX_CHARS = 28;
const EDGE_BUCKETS = 24;
const EDGE_ALPHA_FAR = 0.1;
const EDGE_ALPHA_NEAR = 0.3;
const EDGE_ALPHA_MAX = 0.9;
const EDGE_ALPHA_LIT = 0.8;
const STAR_ALPHA_STEPS = 5;
const PICK_RADIUS = 14;
const STAR_AREA_PER_STAR = 5200;
const LABEL_PLATE_RADIUS = 4;
const HOVER_EASE_MS = 110;
const FOCUS_EASE_MS = 600;
const ENTRANCE_MS = 1400;
const ENTRANCE_MAX_DELAY = 0.35;
const FLOW_PERIOD_MS = 3600;
const FLOW_LEG_ONE = [0.02, 0.36] as const;
const FLOW_LEG_TWO = [0.4, 0.74] as const;
const FLOW_ARCHIVE = [0.76, 0.98] as const;
const DIM_STRENGTH = 0.62;
const EDGE_DIM_STRENGTH = 0.6;
const FOCUS_MODES: readonly CosmosFocus[] = [
  'hero',
  'programs',
  'flow',
  'activity',
];

function truncate(text: string): string {
  return text.length > LABEL_MAX_CHARS
    ? `${text.slice(0, LABEL_MAX_CHARS - 1)}…`
    : text;
}

function baseRadius(node: CosmosNode): number {
  if (node.kind === 'p') return 3.4 + 1.6 * node.degN;
  if (node.kind === 's') return 1.8 + 0.9 * node.degN;
  return 1.1 + 0.55 * node.sz;
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

function distance(a: CosmosNode, b: CosmosNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function farthestNeighbor(
  graph: CosmosGraph,
  neighbors: readonly Set<number>[],
  from: number,
  kind: CosmosNodeKind,
  accept: (index: number) => boolean,
): number {
  const origin = graph.nodes[from];
  if (!origin) return -1;
  let best = -1;
  let bestDistance = -1;
  for (const candidate of neighbors[from] ?? []) {
    const node = graph.nodes[candidate];
    if (!node || node.kind !== kind || !accept(candidate)) continue;
    const d = distance(origin, node);
    if (d > bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
}

function pickFlowPath(
  graph: CosmosGraph,
  neighbors: readonly Set<number>[],
): FlowPath | null {
  const hasRepository = (index: number): boolean => {
    for (const other of neighbors[index] ?? []) {
      if (graph.nodes[other]?.kind === 'r') return true;
    }
    return false;
  };
  let best: FlowPath | null = null;
  let bestLength = -1;
  for (let program = 0; program < graph.programCount; program += 1) {
    const student = farthestNeighbor(
      graph,
      neighbors,
      program,
      's',
      hasRepository,
    );
    if (student < 0) continue;
    const repository = farthestNeighbor(
      graph,
      neighbors,
      student,
      'r',
      () => true,
    );
    if (repository < 0) continue;
    const p = graph.nodes[program];
    const s = graph.nodes[student];
    const r = graph.nodes[repository];
    if (!p || !s || !r) continue;
    const length = distance(p, s) + distance(s, r);
    if (length > bestLength) {
      bestLength = length;
      best = { program, student, repository };
    }
  }
  return best;
}

export function createCosmosRenderer({
  canvas,
  graph,
  theme = NIGHT_THEME,
  dayTheme = DAWN_THEME,
  fontFamily = 'system-ui, sans-serif',
  entranceMs = ENTRANCE_MS,
}: CosmosRendererOptions): CosmosRenderer {
  const ctx = canvas.getContext('2d');
  const count = graph.nodes.length;
  const proj: CosmosProjected[] = graph.nodes.map(() => ({
    ok: false,
    x: 0,
    y: 0,
    scale: 0,
    depth: 0,
  }));
  const neighbors: Set<number>[] = graph.nodes.map(() => new Set<number>());
  for (const edge of graph.edges) {
    neighbors[edge.a]?.add(edge.b);
    neighbors[edge.b]?.add(edge.a);
  }
  const path = pickFlowPath(graph, neighbors);
  const me = path?.student ?? -1;
  const onPath = new Uint8Array(count);
  if (path) {
    onPath[path.program] = 1;
    onPath[path.student] = 1;
    onPath[path.repository] = 1;
  }
  const nearMe = new Uint8Array(count);
  if (me >= 0) {
    nearMe[me] = 1;
    for (const other of neighbors[me] ?? []) nearMe[other] = 1;
  }
  const edgeOnFlow = new Uint8Array(graph.edges.length);
  const edgeNearMe = new Uint8Array(graph.edges.length);
  graph.edges.forEach((edge, e) => {
    if (path) {
      const legOne =
        (edge.a === path.program && edge.b === path.student) ||
        (edge.b === path.program && edge.a === path.student);
      const legTwo =
        (edge.a === path.student && edge.b === path.repository) ||
        (edge.b === path.student && edge.a === path.repository);
      if (legOne || legTwo) edgeOnFlow[e] = 1;
    }
    if (me >= 0 && (edge.a === me || edge.b === me)) edgeNearMe[e] = 1;
  });

  const scatter = new Float64Array(count * 3);
  const delays = new Float64Array(count);
  const scatterRand = createRng(11);
  graph.nodes.forEach((node, i) => {
    const u = scatterRand() * 2 - 1;
    const theta = scatterRand() * 6.283;
    const q = Math.sqrt(1 - u * u);
    const distance = 1.1 + scatterRand() * 1.3;
    scatter[i * 3] = node.x + q * Math.cos(theta) * distance;
    scatter[i * 3 + 1] = node.y + u * distance;
    scatter[i * 3 + 2] = node.z + q * Math.sin(theta) * distance;
    delays[i] = scatterRand() * ENTRANCE_MAX_DELAY;
  });

  const weights: Record<CosmosFocus, number> = {
    hero: 1,
    programs: 0,
    flow: 0,
    activity: 0,
  };
  const palette: {
    -readonly [K in 'edge' | 'program' | 'student' | 'repository']: CosmosColor;
  } = {
    edge: theme.edge,
    program: theme.program,
    student: theme.student,
    repository: theme.repository,
  };
  let ink: CosmosLabelInk = labelInk(theme, dayTheme, 0);
  const kindColor: Record<CosmosNodeKind, CosmosColor> = {
    p: theme.program,
    s: theme.student,
    r: theme.repository,
  };
  const edgeBuckets: number[][] = Array.from(
    { length: EDGE_BUCKETS },
    () => [],
  );
  const nodeBuckets = new Map<string, number[]>();
  const labelBoxes: number[][] = [];
  const widthCache = new Map<string, number>();
  let hoverMix = 0;
  let lastTime = 0;
  let entranceStart: number | null = null;
  let entrance = entranceMs > 0 ? 0 : 1;
  let wPrograms = 0;
  let wFlow = 0;
  let wActivity = 0;
  let viewW = 0;
  let viewH = 0;

  function measure(text: string, font: string): number {
    if (!ctx) return 0;
    const key = `${font}|${text}`;
    const cached = widthCache.get(key);
    if (cached !== undefined) return cached;
    ctx.font = font;
    const width = ctx.measureText(text).width;
    widthCache.set(key, width);
    return width;
  }

  function advanceFocus(focus: CosmosFocus, dt: number): void {
    const step = dt / FOCUS_EASE_MS;
    for (const mode of FOCUS_MODES) {
      const target = mode === focus ? 1 : 0;
      weights[mode] += clamp(target - weights[mode], -step, step);
    }
    wPrograms = smoothstep(0, 1, weights.programs);
    wFlow = smoothstep(0, 1, weights.flow);
    wActivity = smoothstep(0, 1, weights.activity);
    ink = labelInk(theme, dayTheme, wActivity);
    palette.edge = mixColor(theme.edge, dayTheme.edge, wActivity);
    palette.program = mixColor(theme.program, dayTheme.program, wActivity);
    palette.student = mixColor(theme.student, dayTheme.student, wActivity);
    palette.repository = mixColor(
      theme.repository,
      dayTheme.repository,
      wActivity,
    );
    kindColor.p = palette.program;
    kindColor.s = palette.student;
    kindColor.r = palette.repository;
  }

  function advanceEntrance(time: number): void {
    if (entrance >= 1) return;
    if (entranceStart === null) entranceStart = time;
    entrance = clamp((time - entranceStart) / entranceMs, 0, 1);
  }

  function project(frame: CosmosFrame, w: number, h: number): void {
    const view = viewFor(w, h, frame.zoom);
    for (let i = 0; i < count; i += 1) {
      const node = graph.nodes[i];
      const P = proj[i];
      if (!node || !P) continue;
      if (entrance >= 1) {
        projectPoint(node.x, node.y, node.z, frame, view, P);
        continue;
      }
      const delay = delays[i] ?? 0;
      const t = easeOutCubic(clamp((entrance - delay) / (1 - delay), 0, 1));
      projectPoint(
        lerp(scatter[i * 3] ?? node.x, node.x, t),
        lerp(scatter[i * 3 + 1] ?? node.y, node.y, t),
        lerp(scatter[i * 3 + 2] ?? node.z, node.z, t),
        frame,
        view,
        P,
      );
    }
  }

  function lift(i: number, node: CosmosNode): number {
    return (
      wPrograms * (node.kind === 'p' ? 1 : 0) +
      wFlow * (onPath[i] ?? 0) +
      wActivity * (nearMe[i] ?? 0)
    );
  }

  function shade(i: number, node: CosmosNode): number {
    return (
      wPrograms * (node.kind === 'p' ? 0 : 1) +
      wFlow * (1 - (onPath[i] ?? 0)) +
      wActivity * (1 - (nearMe[i] ?? 0))
    );
  }

  function radiusScale(i: number, node: CosmosNode): number {
    return (
      1 +
      0.35 * wPrograms * (node.kind === 'p' ? 1 : 0) +
      0.25 * wFlow * (onPath[i] ?? 0) +
      0.7 * wActivity * (i === me ? 1 : 0)
    );
  }

  function drawStars(w: number, h: number): void {
    if (!ctx) return;
    const fade = (1 - wActivity) * smoothstep(0, 0.4, entrance);
    if (fade <= 0.01) return;
    const total = Math.min(
      graph.stars.length,
      Math.round((w * h) / STAR_AREA_PER_STAR),
    );
    for (let bucket = 1; bucket <= STAR_ALPHA_STEPS; bucket += 1) {
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < total; i += 1) {
        const star = graph.stars[i];
        if (!star || Math.round(star.a * 10) !== bucket) continue;
        const x = star.x * w;
        const y = star.y * h;
        ctx.moveTo(x + star.r, y);
        ctx.arc(x, y, star.r, 0, 6.283);
        any = true;
      }
      if (!any) continue;
      ctx.fillStyle = rgba(theme.star, (bucket / 10) * fade);
      ctx.fill();
    }
  }

  function halo(
    x: number,
    y: number,
    radius: number,
    color: CosmosColor,
    alpha: number,
  ): void {
    if (!ctx || alpha < 0.01 || radius <= 0) return;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, rgba(color, alpha));
    glow.addColorStop(0.45, rgba(color, alpha * 0.35));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 6.283);
    ctx.fill();
  }

  function drawHalos(): void {
    if (!ctx) return;
    if (wPrograms > 0.01) {
      for (let i = 0; i < graph.programCount; i += 1) {
        const node = graph.nodes[i];
        const P = proj[i];
        if (!node || !P || !P.ok) continue;
        const r = baseRadius(node) * P.scale;
        halo(P.x, P.y, r * 4.2, palette.program, 0.3 * wPrograms);
      }
    }
    if (wActivity > 0.01 && me >= 0) {
      const node = graph.nodes[me];
      const P = proj[me];
      if (node && P && P.ok) {
        const r = baseRadius(node) * P.scale;
        halo(P.x, P.y, r * 7, palette.student, 0.32 * wActivity);
      }
    }
  }

  function edgeLit(e: number): number {
    return clamp(
      wFlow * (edgeOnFlow[e] ?? 0) + wActivity * (edgeNearMe[e] ?? 0),
      0,
      1,
    );
  }

  function edgeShade(e: number, kind: string): number {
    return clamp(
      wPrograms * (kind === 'sp' ? 0.35 : 1) +
        wFlow * (1 - (edgeOnFlow[e] ?? 0)) +
        wActivity * (1 - (edgeNearMe[e] ?? 0)),
      0,
      1,
    );
  }

  function drawEdges(hovered: number | null, mix: number): void {
    if (!ctx) return;
    for (const bucket of edgeBuckets) bucket.length = 0;
    const hoverSet = hovered === null ? null : neighbors[hovered];
    const reveal = smoothstep(0.45, 0.95, entrance);
    if (reveal <= 0) return;
    ctx.lineWidth = 1;
    for (let e = 0; e < graph.edges.length; e += 1) {
      const edge = graph.edges[e];
      if (!edge) continue;
      const A = proj[edge.a];
      const B = proj[edge.b];
      if (!A || !B || !A.ok || !B.ok) continue;
      const incident =
        hovered !== null && (edge.a === hovered || edge.b === hovered);
      if (incident) continue;
      let alpha = lerp(
        EDGE_ALPHA_FAR,
        EDGE_ALPHA_NEAR,
        (A.depth + B.depth) / 2,
      );
      alpha = lerp(alpha, EDGE_ALPHA_LIT, edgeLit(e));
      alpha *= 1 - EDGE_DIM_STRENGTH * edgeShade(e, edge.kind);
      if (hoverSet) alpha *= 1 - 0.65 * mix;
      alpha *= reveal;
      const index = clamp(
        Math.floor((alpha / EDGE_ALPHA_MAX) * EDGE_BUCKETS),
        0,
        EDGE_BUCKETS - 1,
      );
      edgeBuckets[index]?.push(e);
    }
    edgeBuckets.forEach((bucket, index) => {
      if (bucket.length === 0) return;
      ctx.beginPath();
      for (const e of bucket) {
        const edge = graph.edges[e];
        if (!edge) continue;
        const A = proj[edge.a];
        const B = proj[edge.b];
        if (!A || !B) continue;
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
      }
      ctx.strokeStyle = rgba(
        palette.edge,
        ((index + 0.5) / EDGE_BUCKETS) * EDGE_ALPHA_MAX,
      );
      ctx.stroke();
    });
    if (hovered === null) return;
    const H = proj[hovered];
    if (!H || !H.ok) return;
    ctx.beginPath();
    for (const other of neighbors[hovered] ?? []) {
      const P = proj[other];
      if (!P || !P.ok) continue;
      ctx.moveTo(H.x, H.y);
      ctx.lineTo(P.x, P.y);
    }
    ctx.strokeStyle = rgba(palette.edge, (0.55 * mix + 0.14) * reveal);
    ctx.stroke();
  }

  function legPoint(
    from: CosmosProjected,
    to: CosmosProjected,
    t: number,
  ): readonly [number, number] {
    const s = smoothstep(0, 1, t);
    return [lerp(from.x, to.x, s), lerp(from.y, to.y, s)];
  }

  function drawPulse(time: number): void {
    if (!ctx || !path || wFlow <= 0.01) return;
    const A = proj[path.program];
    const B = proj[path.student];
    const C = proj[path.repository];
    if (!A || !B || !C || !A.ok || !B.ok || !C.ok) return;
    const phase = (time % FLOW_PERIOD_MS) / FLOW_PERIOD_MS;
    const leg = (range: readonly [number, number]): number =>
      clamp((phase - range[0]) / (range[1] - range[0]), 0, 1);
    let point: readonly [number, number] | null = null;
    let tail: readonly [number, number] | null = null;
    if (phase >= FLOW_LEG_ONE[0] && phase < FLOW_LEG_ONE[1]) {
      const t = leg(FLOW_LEG_ONE);
      point = legPoint(A, B, t);
      tail = legPoint(A, B, Math.max(0, t - 0.12));
    } else if (phase >= FLOW_LEG_TWO[0] && phase < FLOW_LEG_TWO[1]) {
      const t = leg(FLOW_LEG_TWO);
      point = legPoint(B, C, t);
      tail = legPoint(B, C, Math.max(0, t - 0.12));
    } else if (phase >= FLOW_ARCHIVE[0] && phase < FLOW_ARCHIVE[1]) {
      const k = leg(FLOW_ARCHIVE);
      ctx.beginPath();
      ctx.arc(C.x, C.y, lerp(4, 30, easeOutCubic(k)), 0, 6.283);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(palette.edge, (1 - k) * 0.55 * wFlow);
      ctx.stroke();
      return;
    }
    if (!point || !tail) return;
    ctx.beginPath();
    ctx.moveTo(tail[0], tail[1]);
    ctx.lineTo(point[0], point[1]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(palette.edge, 0.55 * wFlow);
    ctx.stroke();
    halo(point[0], point[1], 16, theme.star, 0.55 * wFlow);
    ctx.beginPath();
    ctx.arc(point[0], point[1], 2.6, 0, 6.283);
    ctx.fillStyle = rgba(theme.star, wFlow);
    ctx.fill();
  }

  function nodeAlpha(
    i: number,
    node: CosmosNode,
    P: CosmosProjected,
    hovered: number | null,
    mix: number,
  ): number {
    const floor = node.kind === 'p' ? 0.5 : 0.32;
    let alpha = lerp(floor, 1, P.depth);
    alpha = lerp(alpha, 1, clamp(lift(i, node), 0, 1));
    alpha *= 1 - DIM_STRENGTH * clamp(shade(i, node), 0, 1);
    if (hovered === null) return alpha;
    if (i === hovered || neighbors[hovered]?.has(i)) {
      return lerp(alpha, 1, mix);
    }
    alpha *= 1 - 0.6 * mix;
    return alpha;
  }

  function drawNodes(hovered: number | null, mix: number): void {
    if (!ctx) return;
    for (const bucket of nodeBuckets.values()) bucket.length = 0;
    for (let i = 0; i < count; i += 1) {
      const node = graph.nodes[i];
      const P = proj[i];
      if (!node || !P || !P.ok || i === hovered) continue;
      const alpha = nodeAlpha(i, node, P, hovered, mix);
      const key = `${node.kind}${Math.round(alpha * 10)}`;
      let bucket = nodeBuckets.get(key);
      if (!bucket) {
        bucket = [];
        nodeBuckets.set(key, bucket);
      }
      bucket.push(i);
    }
    const kinds: CosmosNodeKind[] = ['r', 's', 'p'];
    for (const kind of kinds) {
      for (let step = 1; step <= 10; step += 1) {
        const bucket = nodeBuckets.get(`${kind}${step}`);
        if (!bucket || bucket.length === 0) continue;
        ctx.beginPath();
        for (const i of bucket) {
          const node = graph.nodes[i];
          const P = proj[i];
          if (!node || !P) continue;
          const r = baseRadius(node) * P.scale * radiusScale(i, node);
          ctx.moveTo(P.x + r, P.y);
          ctx.arc(P.x, P.y, r, 0, 6.283);
        }
        ctx.fillStyle = rgba(kindColor[kind], step / 10);
        ctx.fill();
      }
    }
    if (hovered === null) return;
    const node = graph.nodes[hovered];
    const P = proj[hovered];
    if (!node || !P || !P.ok) return;
    const r =
      baseRadius(node) *
      P.scale *
      radiusScale(hovered, node) *
      lerp(1, 1.5, mix);
    ctx.beginPath();
    ctx.arc(P.x, P.y, r, 0, 6.283);
    ctx.fillStyle = rgba(kindColor[node.kind], 1);
    ctx.fill();
  }

  function placeLabel(
    i: number,
    text: string,
    size: number,
    weight: number,
    alpha: number,
    w: number,
    h: number,
  ): void {
    if (!ctx || alpha < 0.04) return;
    const node = graph.nodes[i];
    const P = proj[i];
    if (!node || !P || !P.ok) return;
    const font = `${weight} ${size}px ${fontFamily}`;
    const width = measure(text, font);
    const offset = baseRadius(node) * P.scale * radiusScale(i, node) + 6;
    const flip = P.x + offset + width > w - 12;
    const x0 = flip ? P.x - offset - width : P.x + offset;
    const y0 = P.y - size * 0.62;
    const y1 = P.y + size * 0.5;
    if (x0 < 8 || y0 < 8 || y1 > h - 8) return;
    const box = [x0 - 4, y0 - 2, x0 + width + 4, y1 + 2];
    for (const b of labelBoxes) {
      if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) {
        return;
      }
    }
    labelBoxes.push(box);
    ctx.beginPath();
    ctx.roundRect(
      box[0],
      box[1],
      box[2] - box[0],
      box[3] - box[1],
      LABEL_PLATE_RADIUS,
    );
    ctx.fillStyle = rgba(ink.plate, alpha * LABEL_PLATE_ALPHA);
    ctx.fill();
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(ink.text, alpha);
    ctx.fillText(text, x0, P.y);
  }

  function drawLabels(
    w: number,
    h: number,
    hovered: number | null,
    mix: number,
  ): void {
    if (!ctx) return;
    labelBoxes.length = 0;
    const reveal = smoothstep(0.7, 1, entrance);
    if (reveal <= 0) return;
    if (hovered !== null) {
      const node = graph.nodes[hovered];
      if (node && node.kind === 'p' && node.name) {
        placeLabel(
          hovered,
          node.name,
          14,
          600,
          lerp(LABEL_MIN_ALPHA, 1, mix) * reveal,
          w,
          h,
        );
      }
    }
    const dimTo = clamp(wFlow + wActivity + (hovered === null ? 0 : mix), 0, 1);
    const programs: number[] = [];
    for (let i = 0; i < graph.programCount; i += 1) {
      const P = proj[i];
      if (P && P.ok && i !== hovered && graph.nodes[i]?.name) programs.push(i);
    }
    programs.sort((a, b) => (proj[b]?.depth ?? 0) - (proj[a]?.depth ?? 0));
    for (const i of programs) {
      const node = graph.nodes[i];
      const P = proj[i];
      if (!node || !P) continue;
      const lit = lerp(lerp(LABEL_MIN_ALPHA, 0.95, P.depth), 1, wPrograms);
      placeLabel(
        i,
        truncate(node.name),
        Math.round(lerp(lerp(10, 13, P.depth), 13, wPrograms)),
        500,
        lerp(lit, LABEL_MIN_ALPHA, dimTo) * reveal,
        w,
        h,
      );
    }
  }

  function render(frame: CosmosFrame): void {
    if (!ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    viewW = w;
    viewH = h;

    const dpr = Math.min(
      (window.devicePixelRatio || 1) * frame.qualityScale,
      2,
    );
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const dt = clamp(frame.time - lastTime, 0, 50);
    lastTime = frame.time;
    const target = frame.hovered === null ? 0 : 1;
    hoverMix += (target - hoverMix) * (1 - Math.exp(-dt / HOVER_EASE_MS));
    const mix = hoverMix < 0.002 ? 0 : hoverMix;
    const hovered = frame.hovered;

    advanceFocus(frame.focus, dt);
    advanceEntrance(frame.time);
    project(frame, w, h);

    ctx.clearRect(0, 0, w, h);
    drawStars(w, h);
    drawHalos();
    drawEdges(hovered, mix);
    drawPulse(frame.time);
    drawNodes(hovered, mix);
    drawLabels(w, h, hovered, mix);
  }

  function pick(x: number, y: number): number | null {
    if (!viewW || !viewH) return null;
    let best: number | null = null;
    let bestScore = 1;
    for (let i = 0; i < count; i += 1) {
      const node = graph.nodes[i];
      const P = proj[i];
      if (!node || !P || !P.ok) continue;
      const gap = Math.max(
        0,
        Math.hypot(P.x - x, P.y - y) - baseRadius(node) * P.scale,
      );
      const score = gap / PICK_RADIUS - (node.kind === 'p' ? 0.3 : 0);
      if (gap > PICK_RADIUS || score >= bestScore) continue;
      best = i;
      bestScore = score;
    }
    return best;
  }

  return {
    render,
    pick,
    dispose(): void {
      proj.length = 0;
      labelBoxes.length = 0;
      widthCache.clear();
      nodeBuckets.clear();
      viewW = 0;
      viewH = 0;
    },
  };
}
