import {
  FOCUS_PROGRAM,
  type CosmosGraph,
  type CosmosNode,
} from './cosmos-graph';
import { ease, lerp, segment } from './cosmos-theme';

export const TILT = 0.42;
export const PERSP = 3.2;

export interface CosmosWorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CosmosCamera {
  readonly ang: number;
  readonly fx: number;
  readonly fy: number;
  readonly fz: number;
  readonly zoom: number;
  readonly toNebula: number;
  readonly inside: number;
  readonly toHero: number;
  readonly back: number;
  readonly dimOthers: number;
  readonly soloHero: number;
  readonly reveal: number;
}

export function worldXform(node: CosmosNode, ang: number): CosmosWorldPoint {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const x = node.x * ca + node.z * sa;
  const z1 = -node.x * sa + node.z * ca;
  const ct = Math.cos(TILT);
  const st = Math.sin(TILT);
  return { x, y: node.y * ct - z1 * st, z: node.y * st + z1 * ct };
}

/**
 * 다섯 장면의 카메라 안무 — 전체 그래프 → 프로그램 진입 → 내부 →
 * 개인 활동 포커스 → 다시 전체로 후퇴.
 */
export function cameraAt(
  graph: CosmosGraph,
  p: number,
  time: number,
): CosmosCamera {
  const ang = time * 0.000075 + p * 1.15;
  const toNebula = ease(segment(p, 0.14, 0.42));
  const inside = ease(segment(p, 0.42, 0.62));
  const toHero = ease(segment(p, 0.62, 0.8));
  const back = ease(segment(p, 0.86, 1.0));

  const focusNode = graph.nodes[FOCUS_PROGRAM];
  const heroNode = graph.nodes[graph.hero];
  const nebula = focusNode ? worldXform(focusNode, ang) : { x: 0, y: 0, z: 0 };
  const heroPos = heroNode ? worldXform(heroNode, ang) : { x: 0, y: 0, z: 0 };

  let fx = lerp(0, nebula.x, toNebula);
  let fy = lerp(0, nebula.y, toNebula);
  let fz = lerp(0, nebula.z, toNebula);
  fx = lerp(fx, heroPos.x, toHero);
  fy = lerp(fy, heroPos.y, toHero);
  fz = lerp(fz, heroPos.z, toHero);
  fx = lerp(fx, 0, back);
  fy = lerp(fy, 0, back);
  fz = lerp(fz, 0, back);

  let zoom = lerp(1.0, 2.9, toNebula);
  zoom = lerp(zoom, 4.4, inside);
  zoom = lerp(zoom, 6.8, toHero);
  zoom = lerp(zoom, 1.18, back);

  return {
    ang,
    fx,
    fy,
    fz,
    zoom,
    toNebula,
    inside,
    toHero,
    back,
    dimOthers:
      Math.max(segment(p, 0.3, 0.52) * 0.75, ease(segment(p, 0.62, 0.78))) *
      (1 - back),
    soloHero: ease(segment(p, 0.66, 0.8)) * (1 - back),
    reveal: segment(p, 0.4, 0.64),
  };
}

/** 패널이 떠 있는 진행도 구간 — 장면 수와 1:1로 대응한다 */
export const PANEL_RANGES: readonly (readonly [number, number])[] = [
  [0.0, 0.16],
  [0.2, 0.38],
  [0.44, 0.6],
  [0.66, 0.82],
  [0.88, 1.01],
];
