import { MODULE_METADATA } from '@nestjs/common/constants';

import { AdminModule } from './admin/admin.module';
import { discoverAppModuleControllers } from './app-controller-discovery';
import { AppModule } from './app.module';
import { GithubModule } from './github/github.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PlatformModule } from './platform/platform.module';
import { RankingModule } from './ranking/ranking.module';
import { RepositoriesService } from './github/repositories.service';
import { UsersModule } from './users/users.module';
import { ProgramsModule } from './programs/programs.module';
import { StaffModule } from './staff/staff.module';
import { StudentModule } from './student/student.module';
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

    for (const module of [AdminModule, RankingModule]) {
      expect(imports.filter((entry) => entry === module)).toHaveLength(1);
      expect(imports.indexOf(module)).toBeGreaterThan(
        imports.indexOf(GithubModule),
      );
    }
  });

  it('Issue #255 보존 대상 모듈을 각각 한 번 유지한다', () => {
    const imports = getImports();

    for (const module of [
      PlatformModule,
      NotificationsModule,
      UsersModule,
      GithubModule,
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

  it('StudentModule을 ProgramsModule 뒤에 정확히 한 번 노출한다', () => {
    const imports = getImports();

    expect(imports.filter((entry) => entry === StudentModule)).toHaveLength(1);
    expect(imports.indexOf(StudentModule)).toBeGreaterThan(
      imports.indexOf(ProgramsModule),
    );
  });

  it('StaffModule을 StudentModule 뒤에 정확히 한 번 노출한다', () => {
    const imports = getImports();

    expect(imports.filter((entry) => entry === StaffModule)).toHaveLength(1);
    expect(imports.indexOf(StaffModule)).toBeGreaterThan(
      imports.indexOf(StudentModule),
    );
  });

  it('UsersController 다음, ProgramsModule 앞에서 AdminModule 라우트를 등록해 /users/me/profile 흡수를 막는다(#787)', () => {
    const scanOrder: unknown[] = [];
    const scan = (module: unknown): void => {
      const type =
        typeof module === 'object' && module !== null && 'module' in module
          ? module.module
          : module;
      if (scanOrder.includes(type)) return;
      scanOrder.push(type);
      const imports = Reflect.getMetadata(
        MODULE_METADATA.IMPORTS,
        type as object,
      ) as unknown[] | undefined;
      imports?.forEach(scan);
    };
    scan(AppModule);

    expect(scanOrder.indexOf(UsersModule)).toBeLessThan(
      scanOrder.indexOf(AdminModule),
    );
    expect(scanOrder.indexOf(AdminModule)).toBeLessThan(
      scanOrder.indexOf(ProgramsModule),
    );
  });

  it('Notifications 스케줄러보다 Github 스케줄러를 먼저 로드한다', () => {
    const imports = getImports();

    expect(imports.indexOf(GithubModule)).toBeLessThan(
      imports.indexOf(NotificationsModule),
    );
  });

  it('GithubModule이 RepositoriesService를 export 계약으로 노출한다', () => {
    const exports: unknown = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      GithubModule,
    );

    expect(Array.isArray(exports)).toBe(true);
    if (!Array.isArray(exports)) {
      return;
    }

    expect(exports).toContain(RepositoriesService);
  });
});
