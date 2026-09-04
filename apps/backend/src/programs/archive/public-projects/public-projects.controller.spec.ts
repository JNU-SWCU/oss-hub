import { HEADERS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { PublicProjectRow } from './public-projects.repository';
import { PublicProjectsController } from './public-projects.controller';
import type { PublicProjectsService } from './public-projects.service';

function row(
  overrides: Partial<PublicProjectRow> & { id: string },
): PublicProjectRow {
  return {
    projectId: '9001',
    githubRepositoryId: 9001n,
    repositoryName: 'synthetic-repo',
    githubUrl: 'https://github.com/synthetic-org/synthetic-repo',
    publishedAt: new Date('2026-07-20T00:00:00.000Z'),
    programId: 'synthetic-program-1',
    programName: 'synthetic-program',
    trackType: 'EXTRACURRICULAR',
    teamName: null,
    teamMemberCount: 1,
    applicantNickname: 'synthetic-applicant',
    ...overrides,
  };
}

describe('PublicProjectsController', () => {
  it('공개 목록·상세는 저장소 공개 회수 뒤 이전 응답을 저장하지 않는다', () => {
    for (const methodName of ['findPage', 'findDetail'] as const) {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        PublicProjectsController.prototype,
        methodName,
      )?.value;
      expect(typeof handler).toBe('function');
      expect(Reflect.getMetadata(HEADERS_METADATA, handler as object)).toEqual([
        { name: 'Cache-Control', value: 'no-store' },
      ]);
    }
  });

  it('GET / — 서비스 결과를 페이지 응답 DTO로 매핑하고, 서비스가 결정한 raw 커서를 그대로 전달한다', async () => {
    const found = row({ id: 'synthetic-repository-1' });
    const findPage = jest.fn().mockResolvedValue({
      items: [found],
      pageSize: 20,
      nextPageId: 'opaque-cursor',
    });
    const controller = new PublicProjectsController({
      findPage,
    } as unknown as PublicProjectsService);

    const result = await controller.findPage({
      pageId: undefined,
      pageSize: 20,
    });

    expect(findPage).toHaveBeenCalledWith(undefined, 20, undefined);
    expect(result.pageSize).toBe(20);
    expect(result.nextPageId).toBe('opaque-cursor');
    expect(result.items).toEqual([
      {
        projectId: '9001',
        programId: 'synthetic-program-1',
        programName: 'synthetic-program',
        trackType: 'EXTRACURRICULAR',
        applicationMode: 'PERSONAL',
        displayName: 'synthetic-applicant',
        repositoryName: 'synthetic-repo',
        githubUrl: 'https://github.com/synthetic-org/synthetic-repo',
        publishedAt: '2026-07-20T00:00:00.000Z',
      },
    ]);
  });

  it('GET / — pageId·year를 서비스에 그대로 전달한다', async () => {
    const findPage = jest
      .fn()
      .mockResolvedValue({ items: [], pageSize: 5, nextPageId: null });
    const controller = new PublicProjectsController({
      findPage,
    } as unknown as PublicProjectsService);

    await controller.findPage({
      pageId: 'client-provided-cursor',
      pageSize: 5,
      year: 2026,
    });

    expect(findPage).toHaveBeenCalledWith('client-provided-cursor', 5, 2026);
  });

  it('GET /years — 서비스 결과를 연도 응답 DTO로 매핑한다', async () => {
    const listYears = jest.fn().mockResolvedValue([2026, 2025]);
    const controller = new PublicProjectsController({
      listYears,
    } as unknown as PublicProjectsService);

    const result = await controller.listYears();

    expect(listYears).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ years: [2026, 2025] });
  });

  /**
   * Nest는 클래스 메서드 선언 순서로 라우트를 등록한다.
   * 정적 경로 `years`가 파라미터 경로 `:projectId`보다 뒤에 있으면
   * "years"가 projectId로 잡혀 상세 핸들러로 라우팅된다.
   */
  it('GET /years 정적 경로가 :projectId 보다 먼저 등록된다', () => {
    const listYearsHandler: unknown = Object.getOwnPropertyDescriptor(
      PublicProjectsController.prototype,
      'listYears',
    )?.value;
    const findDetailHandler: unknown = Object.getOwnPropertyDescriptor(
      PublicProjectsController.prototype,
      'findDetail',
    )?.value;
    expect(typeof listYearsHandler).toBe('function');
    expect(typeof findDetailHandler).toBe('function');
    if (
      typeof listYearsHandler !== 'function' ||
      typeof findDetailHandler !== 'function'
    ) {
      throw new Error('PublicProjectsController handlers are missing');
    }

    expect(Reflect.getMetadata(PATH_METADATA, listYearsHandler)).toBe('years');
    expect(Reflect.getMetadata(PATH_METADATA, findDetailHandler)).toBe(
      ':projectId',
    );
    expect(Reflect.getMetadata(PATH_METADATA, PublicProjectsController)).toBe(
      'projects',
    );

    const methodNames = Object.getOwnPropertyNames(
      PublicProjectsController.prototype,
    ).filter((name) => name !== 'constructor');
    expect(methodNames.indexOf('listYears')).toBeGreaterThanOrEqual(0);
    expect(methodNames.indexOf('findDetail')).toBeGreaterThanOrEqual(0);
    expect(methodNames.indexOf('listYears')).toBeLessThan(
      methodNames.indexOf('findDetail'),
    );
  });

  it('GET /:projectId — 상세 결과를 응답 DTO로 매핑하며 금지 필드(실명/studentId/이메일 등)를 포함하지 않는다', async () => {
    const found = row({
      id: 'synthetic-repository-1',
      teamName: 'synthetic-team',
      teamMemberCount: 3,
    });
    const findDetail = jest.fn().mockResolvedValue({
      row: found,
      metrics: { commitCount: 10, pullRequestCount: 2, releaseCount: 1 },
      contributors: [
        {
          githubLogin: 'synthetic-login',
          commitCount: 10,
          pullRequestCount: 2,
          releaseCount: 1,
        },
      ],
    });
    const controller = new PublicProjectsController({
      findDetail,
    } as unknown as PublicProjectsService);

    const result = await controller.findDetail('synthetic-repository-1');

    expect(findDetail).toHaveBeenCalledWith('synthetic-repository-1');
    expect(result.applicationMode).toBe('TEAM');
    expect(result.displayName).toBe('synthetic-team');
    expect(result.metrics).toEqual({
      commitCount: 10,
      pullRequestCount: 2,
      releaseCount: 1,
    });
    expect(result.contributors).toEqual([
      {
        githubLogin: 'synthetic-login',
        commitCount: 10,
        pullRequestCount: 2,
        releaseCount: 1,
      },
    ]);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'studentId',
      'department',
      'email',
      'role',
      'rejectionReason',
      'answers',
    ]) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });
  it('1인 팀은 자동 생성 팀명 대신 GitHub 닉네임을 공개 표시명으로 쓴다', async () => {
    // Given — 자동 생성된 1인 팀. 이 응답은 무인증 공개 endpoint로 나가므로
    // 팀명이 그대로 새면 실명 유출 경로가 된다.
    const found = row({
      id: 'synthetic-repository-solo',
      teamName: '홍길동의 팀',
      teamMemberCount: 1,
      applicantNickname: 'synthetic-login',
    });
    const findPage = jest.fn().mockResolvedValue({
      items: [found],
      pageSize: 20,
      nextPageId: null,
    });
    const controller = new PublicProjectsController({
      findPage,
    } as unknown as PublicProjectsService);

    // When
    const result = await controller.findPage({
      pageId: undefined,
      pageSize: 20,
    });

    // Then
    expect(result.items[0]?.displayName).toBe('synthetic-login');
    expect(result.items[0]?.displayName).not.toContain('홍길동');
    expect(result.items[0]?.applicationMode).toBe('PERSONAL');
  });
});
