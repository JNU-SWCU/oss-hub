import {
  projectNode,
  viewFor,
  type CosmosOrbit,
  type CosmosProjected,
} from './cosmos-camera';
import type { CosmosGraph, CosmosNode, CosmosNodeKind } from './cosmos-graph';
import {
  clamp,
  lerp,
  NIGHT_THEME,
  rgba,
  smoothstep,
  type CosmosColor,
  type CosmosTheme,
} from './cosmos-theme';

export interface CosmosFrame extends CosmosOrbit {
  readonly time: number;
  readonly hovered: number | null;
  readonly qualityScale: number;
}

export interface CosmosRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly graph: CosmosGraph;
  readonly theme?: CosmosTheme;
  readonly fontFamily?: string;
}

export interface CosmosRenderer {
  render: (frame: CosmosFrame) => void;
  pick: (x: number, y: number) => number | null;
  dispose: () => void;
}

const LABEL_MAX_CHARS = 28;
const ALPHA_BUCKETS = 8;
const EDGE_ALPHA_FAR = 0.1;
const EDGE_ALPHA_NEAR = 0.3;
const STAR_ALPHA_STEPS = 5;
const PICK_RADIUS = 14;
const STAR_AREA_PER_STAR = 5200;
const NEAR_LABEL_LIMIT = 5;
const NEAR_LABEL_DEPTH = 0.74;
const HOVER_EASE_MS = 110;

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

export function createCosmosRenderer({
  canvas,
  graph,
  theme = NIGHT_THEME,
  fontFamily = 'system-ui, sans-serif',
}: CosmosRendererOptions): CosmosRenderer {
  const ctx = canvas.getContext('2d');
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
  const kindColor: Record<CosmosNodeKind, CosmosColor> = {
    p: theme.program,
    s: theme.student,
    r: theme.repository,
  };
  const edgeBuckets: number[][] = Array.from(
    { length: ALPHA_BUCKETS },
    () => [],
  );
  const nodeBuckets = new Map<string, number[]>();
  const labelBoxes: number[][] = [];
  const widthCache = new Map<string, number>();
  let hoverMix = 0;
  let lastTime = 0;
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

  function drawSky(w: number, h: number): void {
    if (!ctx) return;
    ctx.fillStyle = rgba(theme.void, 1);
    ctx.fillRect(0, 0, w, h);
  }

  function drawStars(w: number, h: number): void {
    if (!ctx) return;
    const count = Math.min(
      graph.stars.length,
      Math.round((w * h) / STAR_AREA_PER_STAR),
    );
    for (let bucket = 1; bucket <= STAR_ALPHA_STEPS; bucket += 1) {
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < count; i += 1) {
        const star = graph.stars[i];
        if (!star || Math.round(star.a * 10) !== bucket) continue;
        const x = star.x * w;
        const y = star.y * h;
        ctx.moveTo(x + star.r, y);
        ctx.arc(x, y, star.r, 0, 6.283);
        any = true;
      }
      if (!any) continue;
      ctx.fillStyle = rgba(theme.star, bucket / 10);
      ctx.fill();
    }
  }

  function drawEdges(hovered: number | null, mix: number): void {
    if (!ctx) return;
    for (const bucket of edgeBuckets) bucket.length = 0;
    const hoverSet = hovered === null ? null : neighbors[hovered];
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
      if (hoverSet) alpha *= 1 - 0.65 * mix;
      const index = clamp(
        Math.floor((alpha / EDGE_ALPHA_NEAR) * ALPHA_BUCKETS),
        0,
        ALPHA_BUCKETS - 1,
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
        theme.edge,
        ((index + 0.5) / ALPHA_BUCKETS) * EDGE_ALPHA_NEAR,
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
    ctx.strokeStyle = rgba(theme.edge, 0.55 * mix + 0.14);
    ctx.stroke();
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
    for (let i = 0; i < graph.nodes.length; i += 1) {
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
          const r = baseRadius(node) * P.scale;
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
    const r = baseRadius(node) * P.scale * lerp(1, 1.5, mix);
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
    color: CosmosColor,
    w: number,
    h: number,
  ): void {
    if (!ctx || alpha < 0.04) return;
    const node = graph.nodes[i];
    const P = proj[i];
    if (!node || !P || !P.ok) return;
    const font = `${weight} ${size}px ${fontFamily}`;
    const width = measure(text, font);
    const offset = baseRadius(node) * P.scale + 6;
    const flip = P.x + offset + width > w - 12;
    const x0 = flip ? P.x - offset - width : P.x + offset;
    const y0 = P.y - size * 0.62;
    const y1 = P.y + size * 0.5;
    const guard = w > 900 ? w * 0.42 : 0;
    if (x0 < guard || y0 < 8 || y1 > h - 8) return;
    if (w <= 900 && P.y > h * 0.62) return;
    const box = [x0 - 4, y0 - 2, x0 + width + 4, y1 + 2];
    for (const b of labelBoxes) {
      if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) {
        return;
      }
    }
    labelBoxes.push(box);
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(theme.void, alpha * 0.85);
    ctx.strokeText(text, x0, P.y);
    ctx.fillStyle = rgba(color, alpha);
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
    if (hovered !== null) {
      const node = graph.nodes[hovered];
      if (node) {
        placeLabel(
          hovered,
          node.name,
          node.kind === 'p' ? 14 : 12,
          node.kind === 'p' ? 600 : 500,
          lerp(0.5, 1, mix),
          theme.label,
          w,
          h,
        );
      }
    }
    const programs: number[] = [];
    for (let i = 0; i < graph.programCount; i += 1) {
      const P = proj[i];
      if (P && P.ok && i !== hovered) programs.push(i);
    }
    programs.sort((a, b) => (proj[b]?.depth ?? 0) - (proj[a]?.depth ?? 0));
    const dim = hovered === null ? 1 : 1 - 0.6 * mix;
    for (const i of programs) {
      const node = graph.nodes[i];
      const P = proj[i];
      if (!node || !P) continue;
      placeLabel(
        i,
        truncate(node.name),
        Math.round(lerp(10, 13, P.depth)),
        500,
        lerp(0.35, 0.95, P.depth) * dim,
        theme.label,
        w,
        h,
      );
    }
    if (w <= 900) return;
    const near: number[] = [];
    for (let i = graph.programCount; i < graph.nodes.length; i += 1) {
      const P = proj[i];
      if (P && P.ok && P.depth > NEAR_LABEL_DEPTH && i !== hovered) {
        near.push(i);
      }
    }
    near.sort((a, b) => (proj[b]?.depth ?? 0) - (proj[a]?.depth ?? 0));
    for (const i of near.slice(0, NEAR_LABEL_LIMIT)) {
      const node = graph.nodes[i];
      const P = proj[i];
      if (!node || !P) continue;
      placeLabel(
        i,
        truncate(node.name),
        10,
        400,
        smoothstep(NEAR_LABEL_DEPTH, 0.96, P.depth) * 0.6 * dim,
        kindColor[node.kind],
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

    const view = viewFor(w, h, frame.zoom);
    for (let i = 0; i < graph.nodes.length; i += 1) {
      const node = graph.nodes[i];
      const P = proj[i];
      if (node && P) projectNode(node, frame, view, P);
    }

    drawSky(w, h);
    drawStars(w, h);
    drawEdges(hovered, mix);
    drawNodes(hovered, mix);
    drawLabels(w, h, hovered, mix);
  }

  function pick(x: number, y: number): number | null {
    if (!viewW || !viewH) return null;
    let best: number | null = null;
    let bestScore = 1;
    for (let i = 0; i < graph.nodes.length; i += 1) {
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
