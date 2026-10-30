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
  return {
    cx: w * 0.5,
    cy: h * 0.48,
    radius: Math.min(w * 0.46, h * 0.42) * zoom,
  };
}

export function projectPoint(
  px: number,
  py: number,
  pz: number,
  orbit: CosmosOrbit,
  view: CosmosView,
  out: CosmosProjected,
): void {
  const cy = Math.cos(orbit.yaw);
  const sy = Math.sin(orbit.yaw);
  const x = px * cy + pz * sy;
  const z1 = -px * sy + pz * cy;
  const cp = Math.cos(orbit.pitch);
  const sp = Math.sin(orbit.pitch);
  const y = py * cp - z1 * sp;
  const z = py * sp + z1 * cp;
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
