import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from './app.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { CollectionModule } from './github/collection.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RankingModule } from './ranking/ranking.module';
import { RepositoriesModule } from './github/repositories.module';
import { RepositoriesService } from './github/service/repositories.service';
import { SubmissionReviewsModule } from './submission-reviews/submission-reviews.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { SystemStatusModule } from './system-status/system-status.module';
import { UsersModule } from './users/users.module';
import { PublicProjectsModule } from './programs/archive/public-projects/public-projects.module';

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
    ]) {
      expect(imports.filter((entry) => entry === module)).toHaveLength(1);
    }
  });

  // #551 — 공개 프로필 라우트는 더 이상 UsersModule과의 import 순서에 의존하지 않는다.
  // 순서를 뒤집어도 `/users/me/profile`이 공개 컨트롤러로 새지 않는다는 증명은
  // `public-projects/public-user-profile-route.http.spec.ts`가 실제 HTTP로 고정하므로,
  // 여기서는 모듈 노출 횟수만 확인하고 순서 제약은 두지 않는다.
  it('PublicProjectsModule을 정확히 한 번 노출한다', () => {
    const imports = getImports();

    expect(
      imports.filter((entry) => entry === PublicProjectsModule),
    ).toHaveLength(1);
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
