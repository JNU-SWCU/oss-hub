import { MODULE_METADATA } from '@nestjs/common/constants';
import { ProgramsModule } from '../programs/programs.module';
import { UsersModule } from '../users/users.module';
import { AccessRequestsController } from './access-requests.controller';
import { StaffDashboardController } from './staff-dashboard.controller';
import { StaffDashboardService } from './staff-dashboard.service';
import { StaffInsightsRepository } from './staff-insights.repository';
import { StaffInsightsService } from './staff-insights.service';
import { StaffModule } from './staff.module';
import { RankingModule } from '../ranking/ranking.module';
import { StaffInsightsQueryService } from './staff-insights-query.service';

describe('StaffModule', () => {
  const getMetadataArray = (key: string): unknown[] => {
    const metadata: unknown = Reflect.getMetadata(key, StaffModule);
    expect(Array.isArray(metadata)).toBe(true);
    return Array.isArray(metadata) ? metadata : [];
  };

  it('도메인 모듈은 exports로만 가져온다', () => {
    expect(getMetadataArray(MODULE_METADATA.IMPORTS)).toEqual([
      ProgramsModule,
      RankingModule,
      UsersModule,
    ]);
  });

  it('교직원 대시보드와 접근 신청 조회 컨트롤러를 등록한다', () => {
    expect(getMetadataArray(MODULE_METADATA.CONTROLLERS)).toEqual([
      StaffDashboardController,
      AccessRequestsController,
    ]);
  });

  it('교직원 대시보드와 인사이트 읽기 provider만 소유한다', () => {
    expect(getMetadataArray(MODULE_METADATA.PROVIDERS)).toEqual([
      StaffDashboardService,
      StaffInsightsRepository,
      StaffInsightsService,
      StaffInsightsQueryService,
    ]);
  });
});
