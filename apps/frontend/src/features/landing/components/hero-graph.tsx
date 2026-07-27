'use client';

import { useEffect, useRef } from 'react';

// 그래프 노드 3종: p=프로그램, s=학생, r=저장소
type NodeKind = 'p' | 's' | 'r';

interface GraphNode {
  kind: NodeKind;
  x: number;
  y: number;
  z: number;
}

interface BackgroundStar {
  x: number;
  y: number;
  r: number;
  ph: number;
}

interface HeroGraphData {
  nodes: GraphNode[];
  edges: Array<[number, number]>;
  stars: BackgroundStar[];
}

// 노드 색상 — canvas 드로잉과 히어로 하단 범례(legend)가 동시에 참조하는 단일 소스.
// 색을 바꾸려면 이 맵만 고치면 되고, 두 파일이 각자 리터럴을 들고 있다가 어긋나는 일이 없다.
export const HERO_NODE_COLORS = Object.freeze({
  program: '#ffffff', // 흰색 발광점 (프로그램)
  student: '#9db9f0', // ≈ --palette-navy-200/300 (학생)
  repository: '#5cc687', // --palette-green-300 (저장소)
});

const SEED = 42;

// 시드 고정 PRNG(mulberry32 계열) — 매 빌드마다 같은 시퀀스를 재현해야
// 그래프 레이아웃이 리렌더 사이에 흔들리지 않는다. Math.random은 쓰지 않는다.
function createRng(seed: number) {
  let s = seed;
  return function rand() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildGraph(nodeCount: number): HeroGraphData {
  const rand = createRng(SEED);
  // Irwin-Hall 근사 정규분포 — 자식 노드를 부모 주위에 뭉치되 자연스럽게 흩뿌린다.
  const gauss = () => (rand() + rand() + rand() - 1.5) * 0.8;

  const programCount = 6;
  const studentCount = Math.round(nodeCount * 0.38);
  const repoCount = Math.max(0, nodeCount - programCount - studentCount);

  const nodes: GraphNode[] = [];
  const edges: Array<[number, number]> = [];

  // 프로그램 노드 6개 — 구 표면(shell)에 고르게 배치
  for (let i = 0; i < programCount; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const r = 0.62;
    const q = Math.sqrt(1 - u * u);
    nodes.push({
      kind: 'p',
      x: q * Math.cos(th) * r,
      y: u * r * 0.7,
      z: q * Math.sin(th) * r,
    });
  }

  // 학생 노드 — 임의의 프로그램 노드에 부착
  for (let i = 0; i < studentCount; i++) {
    const parentIndex = Math.floor(rand() * programCount);
    const parent = nodes[parentIndex];
    nodes.push({
      kind: 's',
      x: parent.x + gauss() * 0.34,
      y: parent.y + gauss() * 0.3,
      z: parent.z + gauss() * 0.34,
    });
    edges.push([parentIndex, nodes.length - 1]);
  }

  // 저장소 노드(나머지 전부) — 임의의 학생 노드에 부착
  for (let i = 0; i < repoCount; i++) {
    const parentIndex = programCount + Math.floor(rand() * studentCount);
    const parent = nodes[parentIndex];
    nodes.push({
      kind: 'r',
      x: parent.x + gauss() * 0.16,
      y: parent.y + gauss() * 0.15,
      z: parent.z + gauss() * 0.16,
    });
    edges.push([parentIndex, nodes.length - 1]);
  }

  // 학생↔학생 보강 엣지 16개 — 트리 형태로만 보이지 않도록 지름길을 추가
  if (studentCount > 1) {
    for (let i = 0; i < 16; i++) {
      const a = programCount + Math.floor(rand() * studentCount);
      let b = a;
      while (b === a) {
        b = programCount + Math.floor(rand() * studentCount);
      }
      edges.push([a, b]);
    }
  }

  // 배경 별 130개 — 그래프와 별개로 은은하게 반짝이는 점묘
  const stars: BackgroundStar[] = [];
  for (let i = 0; i < 130; i++) {
    stars.push({
      x: rand(),
      y: rand(),
      r: 0.5 + rand() * 1.1,
      ph: rand() * Math.PI * 2,
    });
  }

  return { nodes, edges, stars };
}

interface ProjectedNode {
  kind: NodeKind;
  z: number;
  sc: number;
  sx: number;
  sy: number;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  graph: HeroGraphData,
  w: number,
  h: number,
  t: number,
  speed: number,
) {
  // 배경 별 — 시간에 따라 서서히 밝기가 오르내리는 깜빡임
  ctx.fillStyle = '#c9d6f0'; // ≈ --palette-navy-100/200
  for (const st of graph.stars) {
    ctx.globalAlpha = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.001 + st.ph));
    ctx.beginPath();
    ctx.arc(st.x * w, st.y * h, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 전체 그래프를 y축 기준으로 서서히 회전시키고 고정된 각도로 기울여 3D처럼 보이게 함
  const ang = t * 0.00009 * speed;
  const tilt = 0.42;
  const f = 3.1;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.62;

  const projected: ProjectedNode[] = graph.nodes.map((n) => {
    const x1 = n.x * Math.cos(ang) + n.z * Math.sin(ang);
    const z1 = -n.x * Math.sin(ang) + n.z * Math.cos(ang);
    const y2 = n.y * Math.cos(tilt) - z1 * Math.sin(tilt);
    const z2 = n.y * Math.sin(tilt) + z1 * Math.cos(tilt);
    const sc = f / (f - z2);
    return {
      kind: n.kind,
      z: z2,
      sc,
      sx: cx + x1 * R * sc,
      sy: cy + y2 * R * sc,
    };
  });

  // 엣지 — 원근감에 따라 투명도를 낮춰 멀어진 연결선은 흐리게
  ctx.lineWidth = 1;
  for (const [a, b] of graph.edges) {
    const A = projected[a];
    const B = projected[b];
    const d = Math.max(0.15, (A.sc + B.sc) / 2 - 0.55);
    ctx.strokeStyle = `rgba(134,166,222,${(0.2 * d).toFixed(3)})`; // ≈ --palette-navy-300
    ctx.beginPath();
    ctx.moveTo(A.sx, A.sy);
    ctx.lineTo(B.sx, B.sy);
    ctx.stroke();
  }

  // 노드 — z가 작은(더 먼) 순서로 먼저 그려야 뒤에서 앞으로 겹쳐 보인다
  const order = projected
    .map((_, i) => i)
    .sort((i, j) => projected[i].z - projected[j].z);
  for (const i of order) {
    const node = projected[i];
    const depth = Math.max(0.35, Math.min(1.15, node.sc - 0.05));
    ctx.globalAlpha = Math.min(1, depth);

    if (node.kind === 'p') {
      // 프로그램 노드 — 흰색 발광점
      ctx.shadowColor = 'rgba(190,210,250,0.9)';
      ctx.shadowBlur = 16 * depth;
      ctx.fillStyle = HERO_NODE_COLORS.program;
      ctx.beginPath();
      ctx.arc(node.sx, node.sy, 5.5 * depth, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (node.kind === 's') {
      // 학생 노드 — navy-200/300 근사 색 + 은은한 테두리 후광
      ctx.fillStyle = HERO_NODE_COLORS.student;
      ctx.beginPath();
      ctx.arc(node.sx, node.sy, 3.4 * depth, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = Math.min(1, depth) * 0.4;
      ctx.strokeStyle = HERO_NODE_COLORS.student;
      ctx.beginPath();
      ctx.arc(node.sx, node.sy, 5.4 * depth, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // 저장소 노드 — --palette-green-300
      ctx.fillStyle = HERO_NODE_COLORS.repository;
      ctx.beginPath();
      ctx.arc(node.sx, node.sy, 1.9 * depth, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
}

interface HeroGraphProps {
  nodeCount?: number;
  speed?: number;
}

export function HeroGraph({ nodeCount = 110, speed = 1 }: HeroGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // 브라우저 API는 전부 이 effect 안에서만 접근한다 — 이 컴포넌트는
    // renderToStaticMarkup(SSR)로도 렌더되므로 effect 밖에서 접근하면 깨진다.
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const graph = buildGraph(nodeCount);
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const renderFrame = (t: number) => {
      const el = canvasRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return; // 레이아웃 확정 전에는 그리지 않는다

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const backingW = Math.round(w * dpr);
      const backingH = Math.round(h * dpr);
      if (el.width !== backingW || el.height !== backingH) {
        el.width = backingW;
        el.height = backingH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawFrame(ctx, graph, w, h, t, speed);
    };

    if (prefersReducedMotion) {
      // 모션 최소화 사용자에게는 애니메이션 없이 정적 프레임만 그린다 — rAF 루프는
      // 아예 시작하지 않는다. 단, 마운트 직후에는 히어로 섹션의 레이아웃이 아직 확정되지
      // 않아 캔버스 크기가 0×0일 수 있으므로 즉시 그리는 것만으로는 빈 화면으로 남을 수
      // 있다. ResizeObserver는 observe() 호출 직후 현재 박스 크기로 한 번 콜백을 실행하고
      // 이후 실제 크기 변화(리사이즈)마다 다시 실행하므로, 폴링이나 rAF 없이도 "항상 올바른
      // 크기의 정적 프레임"이라는 요구를 만족한다.
      const observer = new ResizeObserver(() => {
        renderFrame(0);
      });
      observer.observe(canvas);
      return () => observer.disconnect();
    }

    let raf = requestAnimationFrame(function loop(t) {
      renderFrame(t);
      raf = requestAnimationFrame(loop);
    });

    return () => cancelAnimationFrame(raf);
  }, [nodeCount, speed]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 block h-full w-full"
    />
  );
}
