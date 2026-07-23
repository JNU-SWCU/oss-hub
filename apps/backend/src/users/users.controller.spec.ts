import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { UpdateMyProfileRequestDto } from './dto/update-my-profile-request.dto';
import { UsersController } from './users.controller';
import type { UsersService } from './users.service';

const githubId = 4242n;
const profile = {
  name: '합성 사용자',
  studentId: '1'.repeat(6),
  department: '인공지능학부',
  isComplete: true,
};

function controller() {
  const getMyProfile = jest.fn().mockResolvedValue(profile);
  const completeMyProfile = jest.fn().mockResolvedValue(profile);
  const service: Pick<UsersService, 'getMyProfile' | 'completeMyProfile'> = {
    getMyProfile,
    completeMyProfile,
  };
  return {
    controller: new UsersController(service),
    getMyProfile,
    completeMyProfile,
  };
}

function readGuards(propertyKey: string): readonly unknown[] {
  const handler: unknown = Object.getOwnPropertyDescriptor(
    UsersController.prototype,
    propertyKey,
  )?.value;
  if (typeof handler !== 'function') {
    throw new Error(`Missing controller handler: ${propertyKey}`);
  }
  const metadata: unknown = Reflect.getMetadata(GUARDS_METADATA, handler);
  return Array.isArray(metadata) ? metadata : [];
}

it('GET은 세션 GitHub ID를 서비스에 전달한다', async () => {
  const fixture = controller();

  await expect(
    fixture.controller.getMyProfile({ sessionGithubId: githubId }),
  ).resolves.toEqual(profile);
  expect(fixture.getMyProfile).toHaveBeenCalledWith(githubId);
});

it('PATCH는 정규화된 DTO를 서비스에 전달한다', async () => {
  const fixture = controller();
  const body = Object.assign(new UpdateMyProfileRequestDto(), {
    name: profile.name,
    studentId: profile.studentId,
    department: profile.department,
  });

  await expect(
    fixture.controller.completeMyProfile({ sessionGithubId: githubId }, body),
  ).resolves.toEqual(profile);
  expect(fixture.completeMyProfile).toHaveBeenCalledWith(githubId, {
    name: profile.name,
    studentId: profile.studentId,
    department: profile.department,
  });
});

it('GET과 PATCH에 읽기/쓰기 가드를 구분해 선언한다', () => {
  expect(readGuards('getMyProfile')).toEqual([SessionGuard]);
  expect(readGuards('completeMyProfile')).toEqual([SessionGuard, OriginGuard]);
});
