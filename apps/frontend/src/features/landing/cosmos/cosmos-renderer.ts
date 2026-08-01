import {
  cameraAt,
  PERSP,
  worldXform,
  type CosmosCamera,
} from './cosmos-camera';
import {
  FOCUS_PROGRAM,
  HERO_HANDLE,
  type CosmosGraph,
  type CosmosNode,
} from './cosmos-graph';
import {
  clamp01,
  DEEP_SPACE_THEME,
  lerp,
  mix,
  rgba,
  shade,
  smoothstep,
  tintAt,
  type CosmosColor,
  type CosmosTheme,
} from './cosmos-theme';

/** 라벨 문구 — 실제 사용자 데이터가 아니라 화면 구성 예시다 */
const HERO_LABEL_SUB = '참여 프로그램 · 팀 저장소 · 제출 기록';
const FOCUS_LABEL_SUB = '진행 중인 프로그램';

interface Projected {
  ok: boolean;
  z: number;
  sc: number;
  sx: number;
  sy: number;
  fog: number;
}

export interface CosmosRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly graph: CosmosGraph;
  readonly theme?: CosmosTheme;
  readonly fontFamily?: string;
}

export interface CosmosRenderer {
  render: (progress: number, time: number, qualityScale?: number) => void;
  dispose: () => void;
}

const BLOOM_SCALE = 3;

export function createCosmosRenderer({
  canvas,
  graph,
  theme = DEEP_SPACE_THEME,
  fontFamily = 'system-ui, sans-serif',
}: CosmosRendererOptions): CosmosRenderer {
  const ctx = canvas.getContext('2d');
  // 블룸 버퍼 — 밝은 코어만 1/3 해상도 버퍼에 따로 그려두고 마지막에 흐리게
  // 덧씌운다. 전체 화면 후처리보다 훨씬 싸고, 글자는 번지지 않는다.
  const bloom = document.createElement('canvas');
  const bctx = bloom.getContext('2d');
  const proj: Projected[] = new Array<Projected>(graph.nodes.length);
  const labelBoxes: number[][] = [];
  let lastP = 0;
  let streakAmt = 0;

  function drawSky(w: number, h: number): void {
    if (!ctx) return;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    for (const [stop, color] of theme.sky) gradient.addColorStop(stop, color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  function drawStars(w: number, h: number, cam: CosmosCamera): void {
    if (!ctx) return;
    const color = theme.star;
    for (const layer of graph.layers) {
      const ox = -cam.fx * layer.depth * w * 0.5;
      const oy = -cam.fy * layer.depth * h * 0.5;
      const spread = 1 + (cam.zoom - 1) * layer.depth * 0.35;
      for (const star of layer.stars) {
        let x = ((star.x - 0.5) * spread + 0.5) * w + ox;
        let y = ((star.y - 0.5) * spread + 0.5) * h + oy;
        x = ((x % w) + w) % w;
        y = ((y % h) + h) % h;
        ctx.globalAlpha = layer.alpha * star.b * 0.55;
        ctx.fillStyle = rgba(color, 1);
        ctx.beginPath();
        ctx.arc(x, y, star.r, 0, 6.283);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * 오로라 커튼 — 여러 겹의 흐린 천이 천천히 흔들린다. 배경을 "검은 하늘"이
   * 아니라 "무언가 있는 하늘"로 만드는 층. 넓은 사각형으로 채우면 좌우 끝이
   * 각져서 "띠"로 보이므로, 굵고 흐린 빗살 여러 개를 겹쳐 시트를 만든다.
   */
  function drawAurora(
    w: number,
    h: number,
    cam: CosmosCamera,
    t: number,
  ): void {
    if (!ctx) return;
    const A = theme.auroraAlpha * (1 - cam.toNebula * 0.55);
    if (A < 0.004) return;
    ctx.globalCompositeOperation = 'screen';

    const STRIPS = 26;
    for (const curtain of graph.curtains) {
      const tint = tintAt(theme.aurora, curtain.tint);
      const tt = t * curtain.speed + curtain.ph;
      const x0 = (curtain.x - curtain.w / 2) * w - cam.fx * w * 0.12;
      const x1 = (curtain.x + curtain.w / 2) * w - cam.fx * w * 0.12;
      const yTop = curtain.top * h - cam.fy * h * 0.12;
      const stripW = ((x1 - x0) / STRIPS) * 1.9;

      for (let i = 0; i < STRIPS; i += 1) {
        const u = (i + 0.5) / STRIPS;
        const bell = Math.sin(u * Math.PI); // 양끝 0, 가운데 1
        const a = A * bell * bell;
        if (a < 0.002) continue;

        const wob = Math.sin(u * 4.1 + tt) * curtain.amp * h;
        const x =
          lerp(x0, x1, u) +
          Math.sin(u * 2.7 + tt * 1.3) * curtain.amp * w * 0.18;
        const yT = yTop + wob;
        const yB =
          yT + curtain.h * h * (0.75 + 0.35 * Math.sin(u * 2.3 + tt * 0.8));
        const skew = Math.sin(u * 1.7 + tt * 0.6) * curtain.amp * w * 0.3;

        const gradient = ctx.createLinearGradient(x, yT, x + skew, yB);
        gradient.addColorStop(0, rgba(tint, 0));
        gradient.addColorStop(0.3, rgba(tint, a * 1.5));
        gradient.addColorStop(0.65, rgba(tint, a * 0.7));
        gradient.addColorStop(1, rgba(tint, 0));
        ctx.strokeStyle = gradient;
        ctx.lineWidth = stripW;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, yT);
        ctx.lineTo(x + skew, yB);
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawNebulae(w: number, h: number, cam: CosmosCamera): void {
    if (!ctx) return;
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < graph.programCount; i += 1) {
      const P = proj[i];
      if (!P || !P.ok) continue;
      const focused = i === FOCUS_PROGRAM;
      const base = Math.min(w, h) * 0.3 * P.sc * cam.zoom * 0.55;
      const radius = Math.max(40, Math.min(base, Math.max(w, h) * 1.4));
      // 검정 배경에서는 성운 구름이 훨씬 잘 보인다. 진입 중인 성운만 밝히고
      // 나머지는 존재만 암시하는 수준으로 낮춘다.
      const strength = focused
        ? 0.22 + cam.toNebula * 0.24
        : 0.12 * (1 - cam.dimOthers * 0.85);
      if (strength <= 0.01) continue;
      const tint = focused ? theme.focusNebulaTint : theme.nebulaTint;
      const gradient = ctx.createRadialGradient(
        P.sx,
        P.sy,
        0,
        P.sx,
        P.sy,
        radius,
      );
      gradient.addColorStop(0, rgba(tint, strength * 0.5));
      gradient.addColorStop(0.35, rgba(tint, strength * 0.2));
      gradient.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(P.sx, P.sy, radius, 0, 6.283);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawEdges(cam: CosmosCamera, t: number): void {
    if (!ctx) return;
    ctx.lineWidth = 1;
    for (const edge of graph.edges) {
      const A = proj[edge.a];
      const B = proj[edge.b];
      if (!A || !B || !A.ok || !B.ok) continue;
      const focused = edge.prog === FOCUS_PROGRAM;
      const onHero =
        graph.heroNeighbors.has(edge.a) && graph.heroNeighbors.has(edge.b);

      let a = 0.14;
      if (focused) {
        const revealed = clamp01((cam.reveal - edge.ord * 0.6) * 3);
        a = 0.14 + 0.32 * revealed * cam.toNebula;
      }
      if (!focused) a *= 1 - cam.dimOthers;
      if (cam.soloHero > 0) a *= onHero ? 1 : 1 - cam.soloHero * 0.95;
      if (a < 0.012) continue;

      const fogT = Math.max(A.fog, B.fog);
      const base =
        onHero && cam.soloHero > 0.2 ? tintAt(theme.repoTints, 0) : theme.edge;
      ctx.strokeStyle = rgba(mix(base, theme.fog, fogT), a * (1 - fogT * 0.5));
      ctx.beginPath();
      ctx.moveTo(A.sx, A.sy);
      ctx.lineTo(B.sx, B.sy);
      ctx.stroke();

      if (focused && cam.toNebula > 0.35 && edge.ord > 0.72) {
        const u = (t * 0.00035 + edge.ord) % 1;
        ctx.fillStyle = rgba(
          tintAt(theme.repoTints, 0),
          0.75 * cam.toNebula * (1 - Math.abs(u - 0.5) * 1.2),
        );
        ctx.beginPath();
        ctx.arc(lerp(A.sx, B.sx, u), lerp(A.sy, B.sy, u), 1.5, 0, 6.283);
        ctx.fill();
      }
    }
  }

  /** 항성(프로그램) — 코로나 + 회절 스파이크 */
  function drawStarBody(
    P: Projected,
    r: number,
    alpha: number,
    ph: number,
  ): void {
    if (!ctx) return;
    const core = theme.program;
    const glow = theme.programGlow;
    // 항성마다 크기가 조금씩 다르되 시간에 따라 뛰지는 않는다 (맥동 제거)
    const pulse = 1 + 0.06 * Math.sin(ph);

    ctx.globalCompositeOperation = 'lighter';
    const g1 = ctx.createRadialGradient(
      P.sx,
      P.sy,
      0,
      P.sx,
      P.sy,
      r * 6 * pulse,
    );
    g1.addColorStop(0, rgba(glow, 0.11 * alpha));
    g1.addColorStop(0.25, rgba(glow, 0.04 * alpha));
    g1.addColorStop(1, rgba(glow, 0));
    ctx.fillStyle = g1;
    ctx.beginPath();
    ctx.arc(P.sx, P.sy, r * 6 * pulse, 0, 6.283);
    ctx.fill();

    const g2 = ctx.createRadialGradient(
      P.sx,
      P.sy,
      0,
      P.sx,
      P.sy,
      r * 2.4 * pulse,
    );
    g2.addColorStop(0, rgba(core, 0.7 * alpha));
    g2.addColorStop(0.4, rgba(glow, 0.16 * alpha));
    g2.addColorStop(1, rgba(glow, 0));
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(P.sx, P.sy, r * 2.4 * pulse, 0, 6.283);
    ctx.fill();

    // 회절 스파이크 — 렌즈를 통해 본 밝은 별의 십자 빛
    const L = r * 7 * pulse;
    const spike = (
      dxu: number,
      dyu: number,
      len: number,
      wdt: number,
    ): void => {
      const gg = ctx.createLinearGradient(
        P.sx - dxu * len,
        P.sy - dyu * len,
        P.sx + dxu * len,
        P.sy + dyu * len,
      );
      gg.addColorStop(0, rgba(glow, 0));
      gg.addColorStop(0.5, rgba(core, 0.5 * alpha));
      gg.addColorStop(1, rgba(glow, 0));
      ctx.strokeStyle = gg;
      ctx.lineWidth = wdt;
      ctx.beginPath();
      ctx.moveTo(P.sx - dxu * len, P.sy - dyu * len);
      ctx.lineTo(P.sx + dxu * len, P.sy + dyu * len);
      ctx.stroke();
    };
    spike(1, 0, L, 1.1);
    spike(0, 1, L * 0.75, 1.1);
    spike(0.707, 0.707, L * 0.36, 0.7);
    spike(0.707, -0.707, L * 0.36, 0.7);
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = rgba(core, alpha);
    ctx.beginPath();
    ctx.arc(P.sx, P.sy, r * pulse, 0, 6.283);
    ctx.fill();

    if (bctx) {
      bctx.fillStyle = rgba(core, alpha * 0.7);
      bctx.beginPath();
      bctx.arc(P.sx, P.sy, r * 1.6 * pulse, 0, 6.283);
      bctx.fill();
    }
  }

  /** 행성(저장소) — 광원 쪽으로 치우친 방사 그라디언트로 구 음영을 만든다 */
  function drawPlanet(
    P: Projected,
    r: number,
    col: CosmosColor,
    ld: { x: number; y: number },
    alpha: number,
  ): void {
    if (!ctx) return;
    if (r < 1.9) {
      ctx.fillStyle = rgba(col, alpha);
      ctx.beginPath();
      ctx.arc(P.sx, P.sy, Math.max(0.8, r), 0, 6.283);
      ctx.fill();
      return;
    }
    // 대기 림 — 검정 배경에서 겹치면 초록 안개처럼 보여서 얕게 잡는다
    const rim = ctx.createRadialGradient(
      P.sx,
      P.sy,
      r * 0.75,
      P.sx,
      P.sy,
      r * 1.55,
    );
    rim.addColorStop(0, rgba(col, 0.14 * alpha));
    rim.addColorStop(0.45, rgba(col, 0.06 * alpha));
    rim.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(P.sx, P.sy, r * 1.55, 0, 6.283);
    ctx.fill();

    // 본체 — 밝은 쪽으로 중심을 옮긴 그라디언트 = 구
    const gx = P.sx + ld.x * r * 0.55;
    const gy = P.sy + ld.y * r * 0.55;
    const gradient = ctx.createRadialGradient(
      gx,
      gy,
      r * 0.06,
      P.sx,
      P.sy,
      r * 1.04,
    );
    gradient.addColorStop(0, rgba(shade(col, 0.5), alpha));
    gradient.addColorStop(0.42, rgba(col, alpha));
    gradient.addColorStop(0.86, rgba(shade(col, -0.55), alpha));
    gradient.addColorStop(1, rgba(shade(col, -0.75), alpha));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(P.sx, P.sy, r, 0, 6.283);
    ctx.fill();

    // 반사 하이라이트
    if (r > 3.4) {
      const hx = P.sx + ld.x * r * 0.42;
      const hy = P.sy + ld.y * r * 0.42;
      const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.42);
      hg.addColorStop(0, rgba([255, 255, 255], 0.32 * alpha));
      hg.addColorStop(1, rgba([255, 255, 255], 0));
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(hx, hy, r * 0.42, 0, 6.283);
      ctx.fill();
    }
  }

  function drawNodes(cam: CosmosCamera): void {
    if (!ctx) return;
    const order: number[] = [];
    for (let i = 0; i < proj.length; i += 1) {
      const P = proj[i];
      if (P && P.ok) order.push(i);
    }
    order.sort((i, j) => (proj[i]?.z ?? 0) - (proj[j]?.z ?? 0));

    for (const i of order) {
      const P = proj[i];
      const node = graph.nodes[i];
      if (!P || !node) continue;
      const focused = node.prog === FOCUS_PROGRAM;
      const onHero = graph.heroNeighbors.has(i);

      let alpha =
        Math.max(0.28, Math.min(1.1, P.sc - 0.03)) * (1 - P.fog * 0.75);
      if (!focused) alpha *= 1 - cam.dimOthers * 0.9;
      if (cam.soloHero > 0) alpha *= onHero ? 1 : 1 - cam.soloHero * 0.92;
      if (alpha < 0.02) continue;
      alpha = Math.min(1, alpha);

      const d = Math.max(0.4, Math.min(2.6, P.sc));

      if (node.kind === 'p') {
        drawStarBody(P, (4.2 + 2.2 * node.degN) * d, alpha, node.ph);
      } else if (node.kind === 'r') {
        // 광원 방향 — 자기 프로그램 항성 쪽 (화면 좌표에서)
        const S = proj[node.light];
        let lx = -0.55;
        let ly = -0.55;
        if (S && S.ok) {
          lx = S.sx - P.sx;
          ly = S.sy - P.sy;
          const m = Math.hypot(lx, ly) || 1;
          lx /= m;
          ly /= m;
        }
        const col = mix(tintAt(theme.repoTints, node.tint), theme.fog, P.fog);
        drawPlanet(P, (1.7 + 1.5 * node.sz) * d, col, { x: lx, y: ly }, alpha);
      } else {
        const isHero = i === graph.hero;
        // 반짝임 없음 — 별마다 고정 크기. 주인공만 상시 조금 크다.
        const tw = isHero ? 1.18 : 0.85 + 0.15 * Math.sin(node.ph);
        const r = (2.2 + 1.5 * node.degN) * d * (isHero ? 1.35 : 1) * tw;
        const col = mix(
          tintAt(theme.studentTints, node.tint),
          theme.fog,
          P.fog,
        );

        // 후광은 아주 얇게만. 별 하나하나가 번지면 그래프 구조가 안 보인다.
        ctx.globalCompositeOperation = 'lighter';
        const hg = ctx.createRadialGradient(P.sx, P.sy, 0, P.sx, P.sy, r * 2.4);
        hg.addColorStop(0, rgba(col, 0.13 * alpha));
        hg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(P.sx, P.sy, r * 2.4, 0, 6.283);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        ctx.fillStyle = rgba(shade(col, 0.25), alpha);
        ctx.beginPath();
        ctx.arc(P.sx, P.sy, r, 0, 6.283);
        ctx.fill();

        // 블룸에는 주인공만 남긴다 — 학생 전부를 넣으면 화면이 뿌예진다
        if (isHero && bctx) {
          bctx.fillStyle = rgba(col, alpha * 0.6);
          bctx.beginPath();
          bctx.arc(P.sx, P.sy, r * 2.0, 0, 6.283);
          bctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // 가까이 간 노드부터 이름이 떠오른다. 겹치면 뒤엣것을 버린다.
  function placeLabel(
    x: number,
    y: number,
    text: string,
    size: number,
  ): boolean {
    const wpx = text.length * size * 0.58;
    const box = [x - 4, y - size, x + wpx, y + 4];
    for (const b of labelBoxes) {
      if (
        (box[0] as number) < (b[2] as number) &&
        (box[2] as number) > (b[0] as number) &&
        (box[1] as number) < (b[3] as number) &&
        (box[3] as number) > (b[1] as number)
      ) {
        return false;
      }
    }
    labelBoxes.push(box);
    return true;
  }

  function drawLabels(w: number, cam: CosmosCamera): void {
    if (!ctx) return;
    labelBoxes.length = 0;
    const leftGuard = w > 900 ? w * 0.4 : 0; // 카피 위에는 라벨을 놓지 않는다

    const put = (
      P: Projected | undefined,
      text: string,
      sub: string | null,
      alpha: number,
      size: number,
      colMain: CosmosColor,
      colSub: CosmosColor,
      forceFlip?: boolean,
    ): void => {
      if (alpha < 0.05 || !P || !P.ok || !ctx) return;
      const flip = forceFlip === undefined ? P.sx > w * 0.76 : forceFlip;
      const dir = flip ? -1 : 1;
      const ax = P.sx + 16 * dir;
      if (!flip && ax < leftGuard) return;
      if (
        !placeLabel(
          flip ? ax - text.length * size * 0.58 : ax,
          P.sy,
          text,
          size,
        )
      )
        return;

      ctx.globalAlpha = alpha;
      ctx.textAlign = flip ? 'right' : 'left';
      ctx.font = `600 ${size}px ${fontFamily}`;
      ctx.fillStyle = rgba(colMain, 0.95);
      ctx.fillText(text, ax, sub ? P.sy - 6 : P.sy + 4);
      if (sub) {
        ctx.font = `400 ${Math.round(size * 0.8)}px ${fontFamily}`;
        ctx.fillStyle = rgba(colSub, 0.85);
        ctx.fillText(sub, ax, P.sy + 11);
      }
      ctx.strokeStyle = rgba(theme.star, alpha * 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(P.sx + 7 * dir, P.sy);
      ctx.lineTo(P.sx + 13 * dir, P.sy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    };

    // 1순위 — 주인공과 그 저장소
    if (cam.soloHero > 0.15) {
      put(
        proj[graph.hero],
        HERO_HANDLE,
        HERO_LABEL_SUB,
        cam.soloHero,
        14,
        theme.star,
        tintAt(theme.studentTints, 0),
      );
      // 저장소 라벨은 주인공 반대쪽으로 뻗는다 — 전부 오른쪽에 놓으면
      // 주인공 라벨과 겹쳐서 하나만 남는다.
      const H = proj[graph.hero];
      graph.heroRepos.forEach((index) => {
        const P = proj[index];
        const away = H && H.ok && P && P.ok ? P.sx < H.sx : undefined;
        put(
          P,
          graph.nodes[index]?.name ?? '',
          null,
          cam.soloHero * 0.85,
          11,
          tintAt(theme.repoTints, 0),
          tintAt(theme.repoTints, 0),
          away,
        );
      });
    }

    // 2순위 — 진입 중인 프로그램
    const focusAlpha =
      Math.min(cam.toNebula, 1 - cam.back) * (1 - cam.soloHero * 0.8);
    put(
      proj[FOCUS_PROGRAM],
      graph.nodes[FOCUS_PROGRAM]?.name ?? '',
      FOCUS_LABEL_SUB,
      focusAlpha,
      13,
      theme.star,
      tintAt(theme.repoTints, 0),
    );

    // 3순위 — 그 밖에 가까이 온 천체들이 스스로 이름을 밝힌다
    const candidates: number[] = [];
    for (let i = 0; i < proj.length; i += 1) {
      const P = proj[i];
      if (!P || !P.ok || P.sc < 1.55) continue;
      if (i === graph.hero || i === FOCUS_PROGRAM) continue;
      const node = graph.nodes[i];
      if (!node) continue;
      // 잔별까지 이름 붙이면 지저분하다
      if (node.kind === 's' && node.degN < 0.45) continue;
      candidates.push(i);
    }
    candidates.sort((a, b) => (proj[b]?.sc ?? 0) - (proj[a]?.sc ?? 0));
    for (const i of candidates.slice(0, 7)) {
      const P = proj[i];
      const node = graph.nodes[i];
      if (!P || !node) continue;
      const alpha =
        smoothstep(1.55, 2.3, P.sc) *
        (1 - P.fog) *
        0.75 *
        (node.prog === FOCUS_PROGRAM ? 1 : 1 - cam.dimOthers) *
        (1 - cam.soloHero * 0.9);
      const col: CosmosColor =
        node.kind === 'p'
          ? theme.star
          : node.kind === 'r'
            ? tintAt(theme.repoTints, node.tint)
            : tintAt(theme.studentTints, node.tint);
      put(P, node.name, null, alpha, node.kind === 'p' ? 13 : 11, col, col);
    }
  }

  /** 빠르게 스크롤할수록 화면 가장자리로 빛줄기가 흐른다 */
  function drawStreaks(
    w: number,
    h: number,
    cx: number,
    cy: number,
    intensity: number,
  ): void {
    if (!ctx || intensity < 0.02) return;
    const R = Math.hypot(w, h) * 0.6;
    ctx.globalCompositeOperation = 'lighter';
    for (const streak of graph.streaks) {
      const ca = Math.cos(streak.a);
      const sa = Math.sin(streak.a);
      const r0 = streak.r0 * R;
      const r1 = (streak.r0 + streak.len * intensity) * R;
      const gradient = ctx.createLinearGradient(
        cx + ca * r0,
        cy + sa * r0,
        cx + ca * r1,
        cy + sa * r1,
      );
      gradient.addColorStop(0, rgba(theme.star, 0));
      gradient.addColorStop(0.5, rgba(theme.star, 0.5 * intensity));
      gradient.addColorStop(1, rgba(theme.star, 0));
      ctx.strokeStyle = gradient;
      ctx.lineWidth = streak.w;
      ctx.beginPath();
      ctx.moveTo(cx + ca * r0, cy + sa * r0);
      ctx.lineTo(cx + ca * r1, cy + sa * r1);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function render(p: number, t: number, qualityScale = 1): void {
    if (!ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;

    const dpr = Math.min((window.devicePixelRatio || 1) * qualityScale, 2);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      bloom.width = Math.max(1, Math.round(bw / BLOOM_SCALE));
      bloom.height = Math.max(1, Math.round(bh / BLOOM_SCALE));
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (bctx) {
      bctx.setTransform(dpr / BLOOM_SCALE, 0, 0, dpr / BLOOM_SCALE, 0, 0);
      bctx.clearRect(0, 0, w, h);
    }

    const cam = cameraAt(graph, p, t);
    const cx = w > 900 ? w * lerp(0.64, 0.54, cam.back) : w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.55;

    // 투영 + 안개(거리에 따라 배경색으로 수렴)
    for (let i = 0; i < graph.nodes.length; i += 1) {
      const node = graph.nodes[i] as CosmosNode;
      const q = worldXform(node, cam.ang);
      const X = (q.x - cam.fx) * cam.zoom;
      const Y = (q.y - cam.fy) * cam.zoom;
      const Z = (q.z - cam.fz) * cam.zoom;
      if (Z > PERSP - 0.25) {
        proj[i] = { ok: false, z: Z, sc: 0, sx: 0, sy: 0, fog: 1 };
        continue;
      }
      const sc = PERSP / (PERSP - Z);
      proj[i] = {
        ok: true,
        z: Z,
        sc,
        sx: cx + X * R * sc,
        sy: cy + Y * R * sc,
        fog: smoothstep(0.55, -2.6, Z), // Z가 작을수록(멀수록) 안개가 짙다
      };
    }

    drawSky(w, h);
    drawStars(w, h, cam);
    drawAurora(w, h, cam, t);
    drawNebulae(w, h, cam);
    drawEdges(cam, t);
    drawNodes(cam);

    // 블룸 합성
    const gain = theme.bloom;
    if (gain > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, gain * 0.55);
      ctx.filter = 'blur(7px)';
      ctx.drawImage(bloom, 0, 0, w, h);
      ctx.filter = 'none';
      ctx.restore();
    }

    drawLabels(w, cam);

    // 스크롤 속도 → 속도선
    const dp = Math.abs(p - lastP);
    lastP = p;
    const want = clamp01((dp - 0.0022) / 0.011);
    streakAmt += (want - streakAmt) * (want > streakAmt ? 0.35 : 0.08);
    drawStreaks(w, h, cx, cy, streakAmt);
  }

  return {
    render,
    dispose(): void {
      bloom.width = 1;
      bloom.height = 1;
      proj.length = 0;
      labelBoxes.length = 0;
    },
  };
}
