import { MODULE_METADATA } from '@nestjs/common/constants';
import { GithubModule } from '../github/github.module';
import { ProgramsModule } from '../programs/programs.module';
import { MilestoneDocumentFeedbackRepository } from './milestone-document-feedback.repository';
import {
  MILESTONE_DOCUMENT_FEEDBACK_CLOCK,
  MilestoneDocumentFeedbackService,
} from './milestone-document-feedback.service';
import { MyRepositoriesController } from './my-repositories.controller';
import { StudentDashboardController } from './student-dashboard.controller';
import { StudentModule } from './student.module';

describe('StudentModule', () => {
  const getMetadataArray = (key: string): unknown[] => {
    const metadata: unknown = Reflect.getMetadata(key, StudentModule);
    expect(Array.isArray(metadata)).toBe(true);
    return Array.isArray(metadata) ? metadata : [];
  };

  it('도메인 모듈은 exports로만 가져온다', () => {
    expect(getMetadataArray(MODULE_METADATA.IMPORTS)).toEqual([
      ProgramsModule,
      GithubModule,
    ]);
  });

  it('학생 대시보드와 내 저장소 컨트롤러를 등록한다', () => {
    expect(getMetadataArray(MODULE_METADATA.CONTROLLERS)).toEqual([
      StudentDashboardController,
      MyRepositoriesController,
    ]);
  });

  it('학생 대시보드 피드백 API와 그 7일 창을 셀 현재 시각 시계를 등록한다', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const clock = providers.find(
      (provider): provider is { readonly useValue: () => Date } =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === MILESTONE_DOCUMENT_FEEDBACK_CLOCK,
    );

    expect(providers).toEqual(
      expect.arrayContaining([
        MilestoneDocumentFeedbackService,
        MilestoneDocumentFeedbackRepository,
      ]),
    );
    const before = Date.now();
    const now = clock?.useValue().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
