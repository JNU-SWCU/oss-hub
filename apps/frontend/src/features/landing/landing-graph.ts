import type {
  LandingArchiveDetail,
  LandingArchiveItem,
  LandingGraph,
  LandingGraphEdge,
  LandingGraphNode,
} from './landing-overview';

const PROGRAM_POSITIONS = [
  { x: 72, y: 20 },
  { x: 82, y: 46 },
  { x: 68, y: 72 },
] as const;
const REPOSITORY_POSITIONS = [
  { x: 46, y: 30 },
  { x: 54, y: 58 },
  { x: 42, y: 78 },
] as const;
const STUDENT_POSITIONS = [
  { x: 20, y: 20 },
  { x: 24, y: 46 },
  { x: 16, y: 72 },
  { x: 34, y: 86 },
] as const;

export function buildPublicLandingGraph(
  archive: readonly LandingArchiveItem[],
  details: readonly LandingArchiveDetail[],
): LandingGraph {
  const nodes: LandingGraphNode[] = [];
  const edges: LandingGraphEdge[] = [];
  let studentPositionIndex = 0;

  archive.forEach((item, index) => {
    const programNodeId = `program:${item.programId}`;
    if (!nodes.some((node) => node.id === programNodeId)) {
      nodes.push({
        id: programNodeId,
        kind: 'program',
        label: item.programName,
        href: `/programs/${item.programId}`,
        ...(PROGRAM_POSITIONS[index] ?? PROGRAM_POSITIONS[0]),
      });
    }

    const repositoryNodeId = `repository:${item.projectId}`;
    nodes.push({
      id: repositoryNodeId,
      kind: 'repository',
      label: item.displayName,
      href: item.detailUrl,
      ...(REPOSITORY_POSITIONS[index] ?? REPOSITORY_POSITIONS[0]),
    });
    edges.push({
      sourceId: repositoryNodeId,
      targetId: programNodeId,
      label: '운영',
    });

    const detail = details.find(
      (candidate) => candidate.projectId === item.projectId,
    );
    detail?.contributors.forEach((contributor) => {
      const studentNodeId = `student:${contributor.githubLogin}`;
      if (!nodes.some((node) => node.id === studentNodeId)) {
        const position =
          STUDENT_POSITIONS[studentPositionIndex] ?? STUDENT_POSITIONS[0];
        studentPositionIndex += 1;
        nodes.push({
          id: studentNodeId,
          kind: 'student',
          label: `@${contributor.githubLogin}`,
          href: `https://github.com/${contributor.githubLogin}`,
          ...position,
        });
      }
      edges.push({
        sourceId: studentNodeId,
        targetId: repositoryNodeId,
        label: '기여',
      });
    });
  });

  return { source: 'public', nodes, edges };
}

export const LANDING_GRAPH_EXAMPLE: LandingGraph = {
  source: 'example',
  nodes: [
    {
      id: 'program:example',
      kind: 'program',
      label: 'OSS 기여 프로그램',
      href: '/programs',
      x: 74,
      y: 30,
    },
    {
      id: 'repository:example',
      kind: 'repository',
      label: 'sample-campus-map',
      href: '/archive',
      x: 48,
      y: 52,
    },
    {
      id: 'student:example-01',
      kind: 'student',
      label: '@sample-dev-01',
      href: null,
      x: 18,
      y: 28,
    },
    {
      id: 'student:example-02',
      kind: 'student',
      label: '@sample-dev-02',
      href: null,
      x: 20,
      y: 72,
    },
  ],
  edges: [
    {
      sourceId: 'student:example-01',
      targetId: 'repository:example',
      label: '기여',
    },
    {
      sourceId: 'student:example-02',
      targetId: 'repository:example',
      label: '기여',
    },
    {
      sourceId: 'repository:example',
      targetId: 'program:example',
      label: '운영',
    },
  ],
};
