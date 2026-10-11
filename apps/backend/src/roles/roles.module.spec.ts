import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import {
  OnboardingController,
  StaffAccessRequestsController,
} from './controller/roles.controller';
import { ConsentsService } from '../consents/service/consents.service';
import { RolesModule } from './roles.module';
import { UsersModule } from '../users/users.module';
import { RolesRepository } from './repository/roles.repository';
import { RolesService } from './service/roles.service';

describe('RolesModule wiring (PR04H)', () => {
  it('owns its onboarding repository and injects it into RolesService without importing users', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, RolesModule),
    ).not.toContain(UsersModule);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, RolesModule)).toEqual(
      [RolesRepository, RolesService],
    );
    expect(
      (Reflect.getMetadata('design:paramtypes', RolesService) as unknown[])[0],
    ).toBe(RolesRepository);
    expect(Reflect.getMetadata('self:paramtypes', RolesService)).toEqual([
      { index: 1, param: ConsentsService },
    ]);
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
