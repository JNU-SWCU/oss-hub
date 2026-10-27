import type { CosmosNode } from './cosmos-graph';

export const INITIAL_ORBIT = { yaw: 0.6, pitch: 0.36, zoom: 1 } as const;

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
