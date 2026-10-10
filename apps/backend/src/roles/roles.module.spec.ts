import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import {
  OnboardingController,
  StaffAccessRequestsController,
} from './controller/roles.controller';
import { RolesModule } from './roles.module';
import { UsersModule } from '../users/users.module';
import { RolesService } from './service/roles.service';
import { UsersOnboardingService } from '../users/service/onboarding.service';

describe('RolesModule wiring (PR04H)', () => {
  it('imports the users-owned onboarding capability without registering a foreign repository', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, RolesModule)).toContain(
      UsersModule,
    );
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, RolesModule)).toEqual(
      [RolesService],
    );
    expect(Reflect.getMetadata('self:paramtypes', RolesService)).toContainEqual(
      { index: 0, param: UsersOnboardingService },
    );
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, UsersModule),
    ).not.toContain(RolesModule);
  });
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
