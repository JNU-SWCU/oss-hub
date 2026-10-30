import { describe, expect, it } from 'vitest';
import { buildPublicLandingGraph } from './landing-graph';
import { deriveLandingStats } from './landing-stats';

describe('landing statistics', () => {
  it('counts unique contributors when projects share a contributor', () => {
    const projects = ['a', 'b'].map((projectId) => ({
      projectId,
      programId: 'p',
      programName: 'Program',
      displayName: projectId,
      detailUrl: '/projects/' + projectId,
    }));
    const details = projects.map(({ projectId }) => ({
      projectId,
      contributors: [{ githubLogin: 'student' }],
    }));

    const stats = deriveLandingStats(
      buildPublicLandingGraph(projects, details),
    );

    expect(stats.items.map((item) => item.value)).toEqual(['1', '2', '1']);
  });
  it('omits counts and note when projects are empty', () => {
    const graph = buildPublicLandingGraph([], []);

    const stats = deriveLandingStats(graph);

    expect(stats).toEqual({ items: [], note: null });
  });
});
