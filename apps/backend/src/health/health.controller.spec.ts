import { HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';
import { HealthModule } from './health.module';

type QueryRaw = (query: TemplateStringsArray) => Promise<unknown>;

async function buildController(queryRaw: QueryRaw): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    imports: [HealthModule],
  })
    .overrideProvider(PrismaService)
    .useValue({ $queryRaw: queryRaw })
    .compile();

  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('PostgreSQL이 응답하면 기존 성공 응답을 반환한다', async () => {
    // Given: PostgreSQL 연결 확인 쿼리가 성공한다.
    const queryRaw = jest
      .fn<Promise<unknown>, [TemplateStringsArray]>()
      .mockResolvedValue([1]);
    const controller = await buildController(queryRaw);

    // When: 헬스 엔드포인트를 조회한다.
    const result = await controller.getHealth();

    // Then: SELECT 1을 한 번 실행하고 기존 응답 형식을 유지한다.
    expect(queryRaw).toHaveBeenCalledWith(['SELECT 1']);
    expect(result).toEqual({ status: 'ok' });
  });

  it('PostgreSQL 연결 확인이 실패하면 503 예외를 반환한다', async () => {
    // Given: PostgreSQL 연결 확인 쿼리가 실패한다.
    const queryRaw = jest
      .fn<Promise<unknown>, [TemplateStringsArray]>()
      .mockRejectedValue(new Error('synthetic database failure'));
    const controller = await buildController(queryRaw);

    // When: 헬스 엔드포인트를 조회한다.
    const action = controller.getHealth();

    // Then: curl --fail이 실패하도록 503 예외로 변환한다.
    await expect(action).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(action).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});
