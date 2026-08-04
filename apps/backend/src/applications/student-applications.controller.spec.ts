import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ApplicationStatus } from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { UpdateStudentApplicationRequestDto } from './dto/update-student-application-request.dto';
import type { StudentApplicationManagementService } from './student-application-management.service';
import { StudentApplicationsController } from './student-applications.controller';

function guards(target: object): readonly unknown[] {
  const value: unknown = Reflect.getMetadata(GUARDS_METADATA, target);
  return Array.isArray(value) ? value : [];
}

function methodGuards(
  methodName: 'updateMine' | 'cancelMine',
): readonly unknown[] {
  const method: unknown = Object.getOwnPropertyDescriptor(
    StudentApplicationsController.prototype,
    methodName,
  )?.value;
  return typeof method === 'function' ? guards(method) : [];
}

const APPLICATION = {
  id: 'application-1',
  programId: 'program-1',
  status: ApplicationStatus.SUBMITTED,
  teamId: null,
  answers: {
    applicantName: '합성 학생',
    title: '제목',
    summary: '요약',
  },
  submittedAt: new Date('2026-07-10T00:00:00.000Z'),
  updatedAt: new Date('2026-07-11T00:00:00.000Z'),
  canManage: true,
} as const;

function createService() {
  return {
    getMine: jest.fn().mockResolvedValue(APPLICATION),
    updateMine: jest.fn().mockResolvedValue(APPLICATION),
    cancelMine: jest.fn().mockResolvedValue({ cancelled: true }),
  } satisfies Pick<
    StudentApplicationManagementService,
    'getMine' | 'updateMine' | 'cancelMine'
  >;
}

describe('StudentApplicationsController', () => {
  it('모든 학생 신청 관리 요청에 SessionGuard를 적용한다', () => {
    expect(guards(StudentApplicationsController)).toEqual([SessionGuard]);
  });

  it('수정과 취소 요청에 OriginGuard를 적용한다', () => {
    expect(methodGuards('updateMine')).toEqual([OriginGuard]);
    expect(methodGuards('cancelMine')).toEqual([OriginGuard]);
  });

  it('내 신청을 ISO 날짜 응답으로 조회한다', async () => {
    // Given
    const service = createService();
    const controller = new StudentApplicationsController(service);

    // When
    const result = await controller.getMine(
      { sessionGithubId: 4242n },
      'program-1',
    );

    // Then
    expect(service.getMine).toHaveBeenCalledWith(4242n, 'program-1');
    expect(result).toMatchObject({
      id: 'application-1',
      submittedAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      canManage: true,
      canEdit: true,
      canCancel: true,
    });
  });

  it('수정 본문을 서비스에 전달한다', async () => {
    // Given
    const service = createService();
    const controller = new StudentApplicationsController(service);
    const body = Object.assign(new UpdateStudentApplicationRequestDto(), {
      answers: { title: '수정 제목', summary: '수정 요약' },
      applicationTemplateVersion: 1,
    });

    // When
    await controller.updateMine({ sessionGithubId: 4242n }, 'program-1', body);

    // Then
    expect(service.updateMine).toHaveBeenCalledWith(4242n, 'program-1', {
      answers: { title: '수정 제목', summary: '수정 요약' },
      applicationTemplateVersion: 1,
    });
  });

  it('취소 요청을 서비스에 전달한다', async () => {
    // Given
    const service = createService();
    const controller = new StudentApplicationsController(service);

    // When
    const result = await controller.cancelMine(
      { sessionGithubId: 4242n },
      'program-1',
    );

    // Then
    expect(service.cancelMine).toHaveBeenCalledWith(4242n, 'program-1');
    expect(result).toEqual({ cancelled: true });
  });
});
