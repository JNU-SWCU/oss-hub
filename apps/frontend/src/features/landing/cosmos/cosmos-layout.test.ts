import { describe, expect, it } from 'vitest';
import { buildCosmosGraph, layoutCosmosGraph } from './cosmos-graph';
import { COSMOS_POSITIONS } from './cosmos-positions';
import { settledCosmosGraph } from './cosmos-layout';

describe('committed cosmos layout', () => {
  it('matches a fresh deterministic layout when the graph is generated', () => {
    const graph = buildCosmosGraph();

    layoutCosmosGraph(graph);

    expect(graph.nodes).toHaveLength(COSMOS_POSITIONS.length);
    const drift = Math.max(
      ...graph.nodes.flatMap(({ x, y, z }, index) => {
        const [px, py, pz] = COSMOS_POSITIONS[index];
        return [Math.abs(x - px), Math.abs(y - py), Math.abs(z - pz)];
      }),
    );
    expect(drift).toBeLessThan(1e-3);
  });

  it('creates independent mutable graphs when two canvases mount', () => {
    const first = settledCosmosGraph();
    const second = settledCosmosGraph();

    first.nodes[0].x = 123;

    expect(second.nodes[0].x).toBe(COSMOS_POSITIONS[0][0]);
  });
});
