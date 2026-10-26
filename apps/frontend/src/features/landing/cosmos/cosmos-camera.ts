import type { CosmosNode } from './cosmos-graph';
import { smoothstep } from './cosmos-theme';

const PERSP = 3.2;

export interface CosmosOrbit {
  readonly yaw: number;
  readonly pitch: number;
  readonly zoom: number;
}

export interface CosmosView {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

export interface CosmosProjected {
  ok: boolean;
  x: number;
  y: number;
  scale: number;
  depth: number;
}

export function viewFor(w: number, h: number, zoom: number): CosmosView {
  if (w > 900) {
    return {
      cx: w * 0.67,
      cy: h * 0.5,
      radius: Math.min(w * 0.42, h * 0.56) * zoom,
    };
  }
  return {
    cx: w * 0.5,
    cy: h * 0.33,
    radius: Math.min(w * 0.62, h * 0.34) * zoom,
  };
}

export function projectNode(
  node: CosmosNode,
  orbit: CosmosOrbit,
  view: CosmosView,
  out: CosmosProjected,
): void {
  const cy = Math.cos(orbit.yaw);
  const sy = Math.sin(orbit.yaw);
  const x = node.x * cy + node.z * sy;
  const z1 = -node.x * sy + node.z * cy;
  const cp = Math.cos(orbit.pitch);
  const sp = Math.sin(orbit.pitch);
  const y = node.y * cp - z1 * sp;
  const z = node.y * sp + z1 * cp;
  if (z > PERSP - 0.4) {
    out.ok = false;
    out.scale = 0;
    out.depth = 1;
    return;
  }
  const scale = PERSP / (PERSP - z);
  out.ok = true;
  out.scale = scale;
  out.x = view.cx + x * view.radius * scale;
  out.y = view.cy + y * view.radius * scale;
  out.depth = smoothstep(-0.78, 0.78, z);
}
