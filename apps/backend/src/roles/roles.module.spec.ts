import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import {
  OnboardingController,
  StaffAccessRequestsController,
} from './roles.controller';
import { RolesModule } from './roles.module';

describe('RolesModule wiring (PR04H)', () => {
  it('셀프서비스 온보딩/역할 요청 컨트롤러만 등록하고, 원자적 전환으로 제거된 레거시 관리자 역할 요청 결정 컨트롤러는 다시 등록하지 않는다', () => {
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      RolesModule,
    );

    expect(controllers).toEqual([
      OnboardingController,
      StaffAccessRequestsController,
    ]);
  });
});
