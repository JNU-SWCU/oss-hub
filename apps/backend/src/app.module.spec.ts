import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

describe('AppModule public routes', () => {
  it.each(['/api/v1/members', '/api/v1/members/synthetic-member-id'])(
    '%s 공개 경로를 제공하지 않는다',
    async (path) => {
      // Given: 실제 AppModule을 외부 연결 없이 실행한다.
      const module = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue({})
        .compile();
      const app: INestApplication = module.createNestApplication();
      app.setGlobalPrefix('api/v1');
      await app.listen(0, '127.0.0.1');

      try {
        // When: 인증 없이 Member 목록 경로를 요청한다.
        const response = await fetch(`${await app.getUrl()}${path}`);

        // Then: 공개 라우터에 등록되지 않아 404를 반환한다.
        expect(response.status).toBe(404);
      } finally {
        await app.close();
      }
    },
  );
});
