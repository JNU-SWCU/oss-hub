import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from './app.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RankingModule } from './ranking/ranking.module';
import { ProfilesModule } from './profiles/profiles.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { RepositoriesService } from './repositories/repositories.service';
import { ShowcaseModule } from './showcase/showcase.module';
import { SubmissionReviewsModule } from './submission-reviews/submission-reviews.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { UsersModule } from './users/users.module';

describe('AppModule public ranking exposure', () => {
  it('공개 적격성 projection 전에는 RankingModule을 노출하지 않는다', () => {
    const imports: unknown = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    );

    expect(Array.isArray(imports)).toBe(true);
    if (!Array.isArray(imports)) {
      return;
    }

    expect(imports).not.toContain(RankingModule);
  });

  it('Issue #255 보존 대상 모듈 여섯 개를 AppModule IMPORTS에 유지한다', () => {
    const imports: unknown = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    );

    expect(Array.isArray(imports)).toBe(true);
    if (!Array.isArray(imports)) {
      return;
    }

    expect(imports).toEqual(
      expect.arrayContaining([
        AuditLogModule,
        NotificationsModule,
        SubmissionsModule,
        UsersModule,
        RepositoriesModule,
        SubmissionReviewsModule,
        ShowcaseModule,
        ProfilesModule,
      ]),
    );
  });

  it('RepositoriesModule이 RepositoriesService를 export 계약으로 노출한다', () => {
    const exports: unknown = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      RepositoriesModule,
    );

    expect(Array.isArray(exports)).toBe(true);
    if (!Array.isArray(exports)) {
      return;
    }

    expect(exports).toContain(RepositoriesService);
  });
});
