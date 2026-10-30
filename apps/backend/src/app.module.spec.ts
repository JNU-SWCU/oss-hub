import { MODULE_METADATA } from '@nestjs/common/constants';

import { discoverAppModuleControllers } from './app-controller-discovery';
import { AppModule } from './app.module';
import { CollectionModule } from './github/collection.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PlatformModule } from './platform/platform.module';
import { RankingModule } from './ranking/ranking.module';
import { RepositoriesModule } from './github/repositories.module';
import { RepositoriesService } from './github/service/repositories.service';
import { SystemStatusModule } from './system-status/system-status.module';
import { UsersModule } from './users/users.module';
import { ProgramsModule } from './programs/programs.module';
import { SubmissionReviewsController } from './programs/submission-reviews.controller';

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

  it('Issue #255 보존 대상 모듈을 각각 한 번 유지한다', () => {
    const imports = getImports();

    for (const module of [
      PlatformModule,
      NotificationsModule,
      UsersModule,
      RepositoriesModule,
    ]) {
      expect(imports.filter((entry) => entry === module)).toHaveLength(1);
    }
  });

  it('Issue #255 SubmissionReviewsController를 정확히 한 번 등록한다', () => {
    const controllers = discoverAppModuleControllers();

    expect(
      controllers.filter((entry) => entry === SubmissionReviewsController),
    ).toHaveLength(1);
  });

  it('ProgramsModule을 정확히 한 번 노출한다', () => {
    const imports = getImports();

    expect(imports.filter((entry) => entry === ProgramsModule)).toHaveLength(1);
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
