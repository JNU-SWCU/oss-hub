import 'reflect-metadata';
import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { DomainException } from '../common/error-code';
import { type PublicProfileResponseDto } from './dto/public-profile-response.dto';
import { PublicProfileController } from './public-profile.controller';
import { PublicProfileService } from './public-profile.service';

describe('PublicProfileController', () => {
  const service = {
    findPublicProfile: jest.fn(),
  } as unknown as jest.Mocked<PublicProfileService>;
  const controller = new PublicProfileController(service);

  beforeEach(() => jest.resetAllMocks());

  it('is anonymous and supplies the public cache header', () => {
    const findPublicProfile = Object.getOwnPropertyDescriptor(
      PublicProfileController.prototype,
      'findPublicProfile',
    )?.value as object;
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PublicProfileController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(GUARDS_METADATA, findPublicProfile),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(HEADERS_METADATA, findPublicProfile),
    ).toContainEqual({
      name: 'Cache-Control',
      value: 'public, max-age=60',
    });
  });

  it('returns the public-profile service response unchanged', async () => {
    const response: PublicProfileResponseDto = {
      userId: 'user-1',
      githubNickname: 'synthetic-user',
      avatarUrl: null,
      repositories: [],
    };
    service.findPublicProfile.mockResolvedValue(response);

    await expect(controller.findPublicProfile('user-1')).resolves.toEqual(
      response,
    );
    expect(service.findPublicProfile.mock.calls).toEqual([['user-1']]);
  });

  it('preserves the public-profile 404 exception', async () => {
    const error = new DomainException({
      code: 'PRF_001',
      status: 404,
      message: '공개 프로필을 찾을 수 없습니다.',
    });
    service.findPublicProfile.mockRejectedValue(error);

    await expect(controller.findPublicProfile('private-user')).rejects.toBe(
      error,
    );
    expect(service.findPublicProfile.mock.calls).toEqual([['private-user']]);
  });
});
