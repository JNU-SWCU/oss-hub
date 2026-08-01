import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import {
  OnboardingController,
  RoleRequestsController,
} from './roles.controller';
import { RolesModule } from './roles.module';

describe('RolesModule wiring (PR04H)', () => {
  it('셀프서비스 온보딩/역할 요청 컨트롤러만 등록하고, 원자적 전환으로 제거된 레거시 관리자 역할 요청 결정 컨트롤러는 다시 등록하지 않는다', () => {
    // Given
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      RolesModule,
    );

    // When / Then — /onboarding(OnboardingController)과 셀프서비스
    // /role-requests(RoleRequestsController, `GET /role-requests/me` ·
    // `POST /role-requests`)만 남는다. 관리자 결정용
    // StaffRoleRequestsController(`GET /role-requests` 목록, `PATCH
    // /role-requests/:id`)는 통합 접근(/admin/access)으로 전환되며 삭제됐다.
    expect(controllers).toEqual([OnboardingController, RoleRequestsController]);
  });
});
