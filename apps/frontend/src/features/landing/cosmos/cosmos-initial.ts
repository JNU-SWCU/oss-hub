import type { CosmosNode, CosmosNodeKind } from './cosmos-graph';
import { clamp, LABEL_MIN_ALPHA, lerp, smoothstep } from './cosmos-theme';

export const INITIAL_ORBIT = { yaw: 0.6, pitch: 0.36, zoom: 1 } as const;
export const COSMOS_EDGE_BUCKETS = 24;
export const COSMOS_NODE_ALPHA_STEPS = 10;

const EDGE_ALPHA_FAR = 0.1;
const EDGE_ALPHA_NEAR = 0.3;
const EDGE_ALPHA_MAX = 0.9;
const EDGE_REVEAL_FLOOR = 0.7;
const EDGE_REVEAL_SPAN = 0.3;
const LABEL_SIZE_FAR = 10;
const LABEL_SIZE_NEAR = 13;
const LABEL_LIT_NEAR = 0.95;

export function cosmosNodeRadius(node: CosmosNode): number {
  switch (node.kind) {
    case 'p':
      return 3.4 + 1.6 * node.degN;
    case 's':
      return 1.8 + 0.9 * node.degN;
    case 'r':
      return 1.1 + 0.55 * node.sz;
  }
}

export function cosmosNodeAlpha(kind: CosmosNodeKind, depth: number): number {
  return lerp(kind === 'p' ? 0.5 : 0.32, 1, depth);
}

export function cosmosNodeAlphaStep(alpha: number): number {
  return Math.round(alpha * COSMOS_NODE_ALPHA_STEPS);
}

export function cosmosEdgeAlpha(depthA: number, depthB: number): number {
  return lerp(EDGE_ALPHA_FAR, EDGE_ALPHA_NEAR, (depthA + depthB) / 2);
}

export function cosmosEdgeReveal(entrance: number): number {
  return EDGE_REVEAL_FLOOR + EDGE_REVEAL_SPAN * smoothstep(0, 1, entrance);
}

export function cosmosEdgeBucket(alpha: number): number {
  return clamp(
    Math.floor((alpha / EDGE_ALPHA_MAX) * COSMOS_EDGE_BUCKETS),
    0,
    COSMOS_EDGE_BUCKETS - 1,
  );
}

export function cosmosEdgeBucketAlpha(bucket: number): number {
  return ((bucket + 0.5) / COSMOS_EDGE_BUCKETS) * EDGE_ALPHA_MAX;
}

export function cosmosLabelSize(depth: number, lift = 0): number {
  return lerp(
    lerp(LABEL_SIZE_FAR, LABEL_SIZE_NEAR, depth),
    LABEL_SIZE_NEAR,
    lift,
  );
}

export function cosmosLabelLit(depth: number, lift = 0): number {
  return lerp(lerp(LABEL_MIN_ALPHA, LABEL_LIT_NEAR, depth), 1, lift);
}
