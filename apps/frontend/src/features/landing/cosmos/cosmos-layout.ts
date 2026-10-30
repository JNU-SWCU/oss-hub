import { buildCosmosGraph } from './cosmos-graph';
import { COSMOS_POSITIONS } from './cosmos-positions';

export function settledCosmosGraph() {
  const graph = buildCosmosGraph();
  graph.nodes.forEach((node, index) => {
    const position = COSMOS_POSITIONS[index];
    if (!position) return;
    [node.x, node.y, node.z] = position;
  });
  return graph;
}
