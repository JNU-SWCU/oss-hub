import 'reflect-metadata';
import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { ProgramCategory } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  PublicArchiveApplicationMode,
  PublicArchiveQueryRequestDto,
} from './dto/public-archive-response.dto';
import { ShowcasePublicController } from './showcase-public.controller';
import { ShowcasePublicService } from './showcase-public.service';

describe('ShowcasePublicController', () => {
  const service = {
    findPage: jest.fn(),
    findDetail: jest.fn(),
  } as unknown as jest.Mocked<ShowcasePublicService>;
  const controller = new ShowcasePublicController(service);

  beforeEach(() => jest.resetAllMocks());

  it('is anonymous and supplies the public cache header', () => {
    const findPage = Object.getOwnPropertyDescriptor(
      ShowcasePublicController.prototype,
      'findPage',
    )?.value as object;
    const findDetail = Object.getOwnPropertyDescriptor(
      ShowcasePublicController.prototype,
      'findDetail',
    )?.value as object;
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ShowcasePublicController),
    ).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, findPage)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, findDetail)).toBeUndefined();
    expect(Reflect.getMetadata(HEADERS_METADATA, findPage)).toContainEqual({
      name: 'Cache-Control',
      value: 'public, max-age=60',
    });
    expect(Reflect.getMetadata(HEADERS_METADATA, findDetail)).toContainEqual({
      name: 'Cache-Control',
      value: 'public, max-age=60',
    });
  });

  it('returns the list service response unchanged', async () => {
    const query = new PublicArchiveQueryRequestDto();
    const response = {
      items: [
        {
          repositoryId: 'repository-1',
          programId: 'program-1',
          programName: 'Synthetic Program',
          category: ProgramCategory.BASIC,
          applicationMode: PublicArchiveApplicationMode.PERSONAL,
          displayName: 'synthetic-user',
          githubUrl: 'https://github.com/JNU-SWCU/synthetic',
          publishedAt: '2026-07-25T00:00:00.000Z',
          detailUrl: '/archive/repository-1',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    service.findPage.mockResolvedValue(response);

    await expect(controller.findPage(query)).resolves.toEqual(response);
    expect(service.findPage.mock.calls).toEqual([[query]]);
  });

  it('preserves the public-project 404 exception', async () => {
    const error = new DomainException({
      code: 'SHW_001',
      status: 404,
      message: '공개 프로젝트를 찾을 수 없습니다.',
    });
    service.findDetail.mockRejectedValue(error);

    await expect(controller.findDetail('private-repository')).rejects.toBe(
      error,
    );
    expect(service.findDetail.mock.calls).toEqual([['private-repository']]);
  });
});
