import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from './app.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { CollectionModule } from './collection/collection.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RankingModule } from './ranking/ranking.module';
import { ProfilesModule } from './profiles/profiles.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { RepositoriesService } from './repositories/repositories.service';
import { ShowcaseModule } from './showcase/showcase.module';
import { SubmissionReviewsModule } from './submission-reviews/submission-reviews.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { SystemStatusModule } from './system-status/system-status.module';
import { UsersModule } from './users/users.module';

describe('AppModule module exposure', () => {
  const getImports = (): unknown[] => {
    const imports: unknown = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    );

    expect(Array.isArray(imports)).toBe(true);
    return Array.isArray(imports) ? imports : [];
  };

  it('canonical projection 뒤에 공개 system status와 ranking을 각각 한 번 노출한다', () => {
    const imports = getImports();

    for (const module of [SystemStatusModule, RankingModule]) {
      expect(imports.filter((entry) => entry === module)).toHaveLength(1);
      expect(imports.indexOf(module)).toBeGreaterThan(
        imports.indexOf(CollectionModule),
      );
    }
  });

  it('Issue #255 보존 대상 모듈 여섯 개를 각각 한 번 유지한다', () => {
    const imports = getImports();

    for (const module of [
      AuditLogModule,
      NotificationsModule,
      SubmissionsModule,
      UsersModule,
      RepositoriesModule,
      SubmissionReviewsModule,
    ]) {
      expect(imports.filter((entry) => entry === module)).toHaveLength(1);
    }
  });

  it('Notifications 스케줄러보다 Collection 스케줄러를 먼저 로드한다', () => {
    const imports = getImports();

    expect(imports.indexOf(CollectionModule)).toBeLessThan(
      imports.indexOf(NotificationsModule),
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
