import { describe, expect, it } from 'vitest';
import { buildPublicLandingGraph } from './landing-graph';
import { deriveLandingStats } from './landing-stats';

describe('landing statistics', () => {
  it('counts unique contributors when projects share a contributor', () => {
    const archive = ['a', 'b'].map((projectId) => ({
      projectId,
      programId: 'p',
      programName: 'Program',
      displayName: projectId,
      detailUrl: '/archive/' + projectId,
    }));
    const details = archive.map(({ projectId }) => ({
      projectId,
      contributors: [{ githubLogin: 'student' }],
    }));

    const stats = deriveLandingStats(buildPublicLandingGraph(archive, details));

    expect(stats.items.map((item) => item.value)).toEqual(['1', '2', '1']);
  });
  it('omits counts and note when the archive is empty', () => {
    const graph = buildPublicLandingGraph([], []);

    const stats = deriveLandingStats(graph);

    expect(stats).toEqual({ items: [], note: null });
  });
});
