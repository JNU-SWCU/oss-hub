import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ProblemDetailFilter } from './problem-detail.filter';

/**
 * 운영 bootstrap과 test/e2e-program-authoring/main.ts의 E2E 진입점이 공유하는
 * HTTP 설정. 두 진입점이 같은 prefix·validation·오류 계약을 쓰도록 여기 한 곳에 둔다.
 *
 * 이 파일은 부수효과가 없어야 한다. src/main.ts처럼 top-level에서 서버를 띄우는
 * 파일을 여기서 import하면, import하는 것만으로 그 부수효과(bootstrap)가 함께
 * 실행된다.
 */
export function configureHttpApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ProblemDetailFilter());
}
