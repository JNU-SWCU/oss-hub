import type {
  LandingArchiveDetail,
  LandingArchiveItem,
  LandingGraph,
  LandingGraphEdge,
  LandingGraphNode,
} from './landing-overview';

/**
 * 좌표는 0~100 백분율 평면이고, 노드 종류마다 세로 열을 나눠 쓴다 — 프로그램은
 * 오른쪽, 저장소는 가운데, 학생은 왼쪽이다. 이 열 구분이 그래프를 "학생 → 저장소
 * → 프로그램" 흐름으로 읽히게 하므로, 어떤 위치든 자기 열을 벗어나면 안 된다.
 *
 * 프로그램·저장소는 고정 슬롯으로 충분하다. 자리 번호가 아카이브 항목의 인덱스인데
 * `parseLandingArchivePage`가 항목을 3개로 잘라 주기 때문이다(landing-overview.ts).
 * 슬롯 수를 줄이거나 그 slice 를 늘리면 아래 `?? [0]` 폴백이 살아나 노드가 겹친다.
 */
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

/**
 * 학생 노드가 놓이는 왼쪽 열. 저장소 열(x 42~54)과 겹치지 않게 좁게 잡는다.
 */
const STUDENT_BAND = {
  xNear: 18,
  xFar: 32,
  yTop: 20,
  yBottom: 86,
} as const;

/**
 * 2진 radical inverse(van der Corput 수열). 인덱스를 2진수로 뒤집어 소수부로 읽는다:
 * 0 → 0, 1 → .5, 2 → .25, 3 → .75, 4 → .125 …
 *
 * 두 가지를 동시에 준다. 뒤집기가 일대일이라 **서로 다른 인덱스는 반드시 서로 다른
 * 값**이 되고, 값이 구간을 절반씩 갈라 채우므로 몇 개가 오든 고르게 흩어진다.
 */
function radicalInverse2(index: number): number {
  let result = 0;
  let fraction = 1;
  let remaining = index;
  while (remaining > 0) {
    fraction /= 2;
    result += fraction * (remaining % 2);
    remaining = Math.floor(remaining / 2);
  }
  return result;
}

/**
 * 학생 위치는 표에서 꺼내지 않고 인덱스에서 만든다.
 *
 * 예전에는 고정 슬롯 4개를 두고 넘치면 `STUDENT_POSITIONS[0]`으로 되돌렸는데, 공개
 * 아카이브는 프로젝트 3개 × 프로젝트당 기여자 2명 = 학생 6명까지 낼 수 있다
 * (landing-overview.ts의 두 slice). 즉 5번째부터는 1번 자리에 그대로 겹쳐 쌓였다.
 * 지금은 이 좌표를 그리는 곳이 없어(랜딩 여정은 개수·라벨만 읽고, 우주 연출은 자체
 * 기하를 만든다) 드러나지 않을 뿐, 누군가 이 좌표로 그리는 순간 버그가 된다.
 *
 * 표를 늘리는 대신 인덱스에서 만드는 쪽을 골랐다. 표는 "지금 몇 명까지 오는가"라는
 * 바깥 사정에 맞춰 계속 손봐야 하고, 그 숫자가 바뀌는 순간 다시 조용히 겹친다.
 * 인덱스에서 만들면 몇 명이 오든 겹칠 수 없다는 것이 자리 계산 자체의 성질이 된다.
 * 반대로 인원을 잘라 내는 방법은 택하지 않았다 — 잘린 학생의 `기여` 엣지까지 함께
 * 지워야 하고, 그러면 실제로 기여한 사람이 그래프에서 소리 없이 사라진다.
 *
 * y는 위 수열로 띠 안을 갈라 채우고(인덱스마다 다른 값), x는 두 줄을 번갈아 써서
 * 한 줄로 곧게 서지 않게 한다 — y가 이미 다르므로 x는 겹쳐도 좌표는 겹치지 않는다.
 */
function studentPosition(index: number): {
  readonly x: number;
  readonly y: number;
} {
  return {
    x: index % 2 === 0 ? STUDENT_BAND.xNear : STUDENT_BAND.xFar,
    y:
      STUDENT_BAND.yTop +
      radicalInverse2(index) * (STUDENT_BAND.yBottom - STUDENT_BAND.yTop),
  };
}

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
        const position = studentPosition(studentPositionIndex);
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
