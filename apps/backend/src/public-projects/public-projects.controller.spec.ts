import { PATH_METADATA } from '@nestjs/common/constants';
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
    category: 'BASIC',
    teamName: null,
    applicantNickname: 'synthetic-applicant',
    ...overrides,
  };
}

describe('PublicProjectsController', () => {
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
        category: 'BASIC',
        applicationMode: 'PERSONAL',
        displayName: 'synthetic-applicant',
        repositoryName: 'synthetic-repo',
        githubUrl: 'https://github.com/synthetic-org/synthetic-repo',
        publishedAt: '2026-07-20T00:00:00.000Z',
      },
    ]);
  });

  it('GET / — pageId·category를 서비스에 그대로 전달한다', async () => {
    const findPage = jest
      .fn()
      .mockResolvedValue({ items: [], pageSize: 5, nextPageId: null });
    const controller = new PublicProjectsController({
      findPage,
    } as unknown as PublicProjectsService);

    await controller.findPage({
      pageId: 'client-provided-cursor',
      pageSize: 5,
      category: 'CAPSTONE',
    });

    expect(findPage).toHaveBeenCalledWith(
      'client-provided-cursor',
      5,
      'CAPSTONE',
    );
  });

  it('GET /category-counts — 서비스 결과를 카운트 응답 DTO로 매핑한다', async () => {
    const categoryCounts = jest.fn().mockResolvedValue({
      all: 3,
      BASIC: 1,
      SW_VALUE_SPREAD: 0,
      OSS_CONTEST: 1,
      CAPSTONE: 1,
      SW_CONVERGENCE: 0,
      GLOBAL_MAKERTHON: 0,
      CORPORATE_INTERNSHIP: 0,
    });
    const controller = new PublicProjectsController({
      categoryCounts,
    } as unknown as PublicProjectsService);

    const result = await controller.categoryCounts();

    expect(categoryCounts).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      all: 3,
      BASIC: 1,
      SW_VALUE_SPREAD: 0,
      OSS_CONTEST: 1,
      CAPSTONE: 1,
      SW_CONVERGENCE: 0,
      GLOBAL_MAKERTHON: 0,
      CORPORATE_INTERNSHIP: 0,
    });
  });

  /**
   * Nest는 클래스 메서드 선언 순서로 라우트를 등록한다.
   * 정적 경로 `category-counts`가 파라미터 경로 `:projectId`보다 뒤에 있으면
   * "category-counts"가 projectId로 잡혀 상세 핸들러로 라우팅된다.
   */
  it('GET /category-counts 정적 경로가 :projectId 보다 먼저 등록된다', () => {
    const categoryCountsHandler: unknown = Object.getOwnPropertyDescriptor(
      PublicProjectsController.prototype,
      'categoryCounts',
    )?.value;
    const findDetailHandler: unknown = Object.getOwnPropertyDescriptor(
      PublicProjectsController.prototype,
      'findDetail',
    )?.value;
    expect(typeof categoryCountsHandler).toBe('function');
    expect(typeof findDetailHandler).toBe('function');
    if (
      typeof categoryCountsHandler !== 'function' ||
      typeof findDetailHandler !== 'function'
    ) {
      throw new Error('PublicProjectsController handlers are missing');
    }

    expect(Reflect.getMetadata(PATH_METADATA, categoryCountsHandler)).toBe(
      'category-counts',
    );
    expect(Reflect.getMetadata(PATH_METADATA, findDetailHandler)).toBe(
      ':projectId',
    );
    expect(Reflect.getMetadata(PATH_METADATA, PublicProjectsController)).toBe(
      'projects',
    );

    const methodNames = Object.getOwnPropertyNames(
      PublicProjectsController.prototype,
    ).filter((name) => name !== 'constructor');
    expect(methodNames.indexOf('categoryCounts')).toBeGreaterThanOrEqual(0);
    expect(methodNames.indexOf('findDetail')).toBeGreaterThanOrEqual(0);
    expect(methodNames.indexOf('categoryCounts')).toBeLessThan(
      methodNames.indexOf('findDetail'),
    );
  });

  it('GET /:projectId — 상세 결과를 응답 DTO로 매핑하며 금지 필드(실명/studentId/이메일 등)를 포함하지 않는다', async () => {
    const found = row({
      id: 'synthetic-repository-1',
      teamName: 'synthetic-team',
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
});
