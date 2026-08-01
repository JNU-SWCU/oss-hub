import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from './app.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { CollectionModule } from './collection/collection.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RankingModule } from './ranking/ranking.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { RepositoriesService } from './repositories/repositories.service';
import { ShowcaseModule } from './showcase/showcase.module';
import { SubmissionReviewsModule } from './submission-reviews/submission-reviews.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { SystemStatusModule } from './system-status/system-status.module';
import { UsersModule } from './users/users.module';
import { PublicProjectsModule } from './public-projects/public-projects.module';

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

  it('Issue #255 보존 대상 모듈 일곱 개를 각각 한 번 유지한다', () => {
    const imports = getImports();

    for (const module of [
      AuditLogModule,
      NotificationsModule,
      SubmissionsModule,
      UsersModule,
      RepositoriesModule,
      SubmissionReviewsModule,
      ShowcaseModule,
    ]) {
      expect(imports.filter((entry) => entry === module)).toHaveLength(1);
    }
  });

  it('todo 16 — PublicProjectsModule을 UsersModule 바로 다음, RepositoriesModule 이전에 정확히 한 번 노출한다(라우트 순서: /users/me/profile이 /users/:userId/profile보다 먼저 매칭돼야 한다)', () => {
    const imports = getImports();

    expect(
      imports.filter((entry) => entry === PublicProjectsModule),
    ).toHaveLength(1);
    expect(imports.indexOf(PublicProjectsModule)).toBeGreaterThan(
      imports.indexOf(UsersModule),
    );
    expect(imports.indexOf(PublicProjectsModule)).toBeLessThan(
      imports.indexOf(RepositoriesModule),
    );
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
});
