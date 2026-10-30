import { describe, expect, it } from 'vitest';
import {
  applyCosmosPrograms,
  buildCosmosGraph,
  COSMOS_PROGRAM_COUNT,
} from './cosmos-graph';

const BASIC = {
  name: 'seed-program-basic',
  href: '/programs/seed%3Aintake%3Aprogram-seven-templates%3ABASIC',
};
const CAPSTONE = {
  name: 'seed-program-capstone',
  href: '/programs/seed%3Aintake%3Aprogram-seven-templates%3ACAPSTONE',
};

const programNodes = (graph: ReturnType<typeof buildCosmosGraph>) =>
  graph.nodes.filter((node) => node.kind === 'p');

describe('buildCosmosGraph', () => {
  it('builds the synthetic constellation without placeholder names or links', () => {
    const graph = buildCosmosGraph();

    expect(graph.programCount).toBe(COSMOS_PROGRAM_COUNT);
    expect(programNodes(graph)).toHaveLength(COSMOS_PROGRAM_COUNT);
    expect(graph.nodes.length).toBeGreaterThan(COSMOS_PROGRAM_COUNT);
    expect(
      graph.nodes.every((node) => node.name === '' && node.href === null),
    ).toBe(true);
  });
});

describe('applyCosmosPrograms', () => {
  it('names program stars in order from real programs and leaves the rest unlabeled', () => {
    const graph = buildCosmosGraph();

    applyCosmosPrograms(graph, [BASIC]);

    const [first, ...rest] = programNodes(graph);
    expect(first).toMatchObject(BASIC);
    expect(rest).toHaveLength(COSMOS_PROGRAM_COUNT - 1);
    expect(rest.every((node) => node.name === '' && node.href === null)).toBe(
      true,
    );
    expect(
      graph.nodes
        .filter((node) => node.kind !== 'p')
        .every((node) => node.name === '' && node.href === null),
    ).toBe(true);
  });

  it('clears the name and link of a star that a shorter program list no longer backs', () => {
    const graph = buildCosmosGraph();

    applyCosmosPrograms(graph, [BASIC, CAPSTONE]);
    expect(programNodes(graph)[1]).toMatchObject(CAPSTONE);

    applyCosmosPrograms(graph, [BASIC]);
    expect(programNodes(graph)[1]).toMatchObject({ name: '', href: null });
  });
});
