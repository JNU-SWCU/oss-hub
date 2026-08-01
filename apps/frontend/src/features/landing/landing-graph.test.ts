import { describe, expect, it } from 'vitest';
import { buildPublicLandingGraph } from './landing-graph';
import type {
  LandingArchiveDetail,
  LandingArchiveItem,
} from './landing-overview';

function archiveItem(index: number): LandingArchiveItem {
  const projectId = `repo_public_${index}`;
  return {
    projectId,
    programId: `program_public_${index}`,
    programName: `공개 프로그램 ${index}`,
    displayName: `campus-map-${index}`,
    detailUrl: `/archive/${projectId}`,
  };
}

function detailWith(
  index: number,
  contributorCount: number,
): LandingArchiveDetail {
  return {
    projectId: `repo_public_${index}`,
    contributors: Array.from({ length: contributorCount }, (_, seat) => ({
      githubLogin: `dev-${index}-${seat}`,
    })),
  };
}

function studentCoordinates(
  projectCount: number,
  contributorsPerProject: number,
): readonly string[] {
  const archive = Array.from({ length: projectCount }, (_, index) =>
    archiveItem(index),
  );
  const details = archive.map((_, index) =>
    detailWith(index, contributorsPerProject),
  );

  return buildPublicLandingGraph(archive, details)
    .nodes.filter((node) => node.kind === 'student')
    .map((node) => `${node.x},${node.y}`);
}

describe('buildPublicLandingGraph 학생 노드 배치', () => {
  // 공개 아카이브가 실제로 낼 수 있는 최대치다 — 프로젝트 3개(archive slice)에
  // 프로젝트당 기여자 2명(detail slice). 고정 슬롯 4개 시절에는 5·6번째 학생이
  // 1번 슬롯으로 되돌려져 같은 좌표에 그대로 겹쳐 쌓였다.
  it('공개 응답 최대치인 학생 6명이 모두 다른 좌표를 갖는다', () => {
    const coordinates = studentCoordinates(3, 2);

    expect(coordinates).toHaveLength(6);
    expect(new Set(coordinates).size).toBe(coordinates.length);
  });

  // 자리 수를 늘려 막는 방식이었다면 그 수를 넘는 순간 다시 겹친다. 겹치지 않는
  // 것이 자리 계산 자체의 성질인지 확인하려면 응답 상한보다 훨씬 많이 넣어 본다.
  it('상한을 넘겨 학생이 40명 와도 좌표가 겹치지 않는다', () => {
    const coordinates = studentCoordinates(4, 10);

    expect(coordinates).toHaveLength(40);
    expect(new Set(coordinates).size).toBe(coordinates.length);
  });

  // 겹치지 않게 흩는 것만으로는 부족하다. 학생이 저장소 열(x 42~54)이나 화면
  // 밖으로 흘러 나가면 "학생 → 저장소 → 프로그램" 흐름이 읽히지 않는다.
  it('학생은 몇 명이 오든 왼쪽 열 안에 머문다', () => {
    const archive = Array.from({ length: 4 }, (_, index) => archiveItem(index));
    const details = archive.map((_, index) => detailWith(index, 10));

    const students = buildPublicLandingGraph(archive, details).nodes.filter(
      (node) => node.kind === 'student',
    );

    for (const student of students) {
      expect(student.x).toBeGreaterThanOrEqual(16);
      expect(student.x).toBeLessThanOrEqual(36);
      expect(student.y).toBeGreaterThanOrEqual(18);
      expect(student.y).toBeLessThanOrEqual(88);
    }
  });
});
